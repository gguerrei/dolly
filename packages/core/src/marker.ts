import { createHash } from "node:crypto";
import { cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { RULE_IDS, type RuleId } from "./check/rule";
import { importBundle } from "./export/bundle";
import { isSafePatternPath, patternSchema } from "./pattern/schema";
import { PatternStore } from "./store";

/**
 * The `.dolly` marker: a committed YAML file linking a project to its
 * pattern. `new` and `link` write it, check and fit resolve the pattern
 * from it, and the rest of it is the project's own word: `ignore` lists
 * the paths check leaves alone (a mandated kebab-case script in a
 * snake_case repo, a legacy file nobody may rename), `rules` turns a rule
 * off or down to a warning, and `source` says where the pattern's files
 * live when the machine's store is not the place (a directory vendored
 * into the repository, or a bundle on the web), so a checkout carries what
 * its CI and its teammates need. Entries in `ignore` are relative paths
 * with `*` and `**`; a directory entry covers everything under it.
 */
export const MARKER_FILE = ".dolly";

/** Where `dolly link --vendor` puts the pattern: the store's own layout, under the project root. */
export const VENDOR_DIR = "dolly";

export type RuleSetting = "off" | "warn";

export interface Marker {
  pattern: string;
  /** A project-relative directory in the store's layout, or a URL to a .dolly bundle. */
  source?: string;
  ignore: string[];
  rules: Partial<Record<RuleId, RuleSetting>>;
}

/** A bundle URL: https anywhere, plain http only on this machine. */
const BUNDLE_URL = /^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)(:|\/))/;

const markerSchema = z.strictObject({
  pattern: patternSchema.shape.name,
  source: z
    .string()
    .refine(
      (s) => BUNDLE_URL.test(s) || isSafePatternPath(s),
      "source is a project-relative directory or an https URL to a .dolly bundle",
    )
    .optional(),
  ignore: z
    .array(z.string().refine(isSafePatternPath, "ignore entries are relative paths"))
    .default([]),
  rules: z.partialRecord(z.enum(RULE_IDS), z.enum(["off", "warn"])).default({}),
});

export class MarkerError extends Error {
  override name = "MarkerError";
}

/** The marker's YAML, carrying only what is set. */
export function markerContents(marker: {
  pattern: string;
  source?: string;
  ignore?: string[];
  rules?: Partial<Record<RuleId, RuleSetting>>;
}): string {
  return stringifyYaml({
    pattern: marker.pattern,
    ...(marker.source ? { source: marker.source } : {}),
    ...(marker.ignore?.length ? { ignore: marker.ignore } : {}),
    ...(Object.keys(marker.rules ?? {}).length ? { rules: marker.rules } : {}),
  });
}

/** The marker as data, undefined without one; a marker that does not parse is an error, never silence. */
export async function readMarker(projectDir: string): Promise<Marker | undefined> {
  const file = Bun.file(join(resolve(projectDir), MARKER_FILE));
  if (!(await file.exists())) return undefined;
  let raw: unknown;
  try {
    raw = parseYaml(await file.text());
  } catch (cause) {
    throw new MarkerError(`${MARKER_FILE} is not valid YAML: ${(cause as Error).message}`);
  }
  const parsed = markerSchema.safeParse(raw);
  if (!parsed.success) {
    throw new MarkerError(
      `${MARKER_FILE} is not a valid marker:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

/** The pattern the marker names, or undefined without a marker. */
export async function readPatternMarker(projectDir: string): Promise<string | undefined> {
  return (await readMarker(projectDir))?.pattern;
}

/** A pattern and the store it lives in: what every verb that takes a project resolves first. */
export interface PatternRef {
  store: PatternStore;
  name: string;
}

/**
 * Where a project's pattern lives. An explicit name beats the marker and
 * reads from the machine's store; a marker without `source` does the same;
 * a `source` directory is read as a store rooted there, and a `source` URL
 * is fetched into a temporary store for this run under the same caps as
 * `dolly import`. Undefined when nothing names a pattern.
 */
export async function resolvePattern(
  store: PatternStore,
  projectDir: string,
  explicit?: string,
): Promise<PatternRef | undefined> {
  if (explicit) return { store, name: explicit };
  const marker = await readMarker(projectDir);
  if (!marker) return undefined;
  if (!marker.source) return { store, name: marker.pattern };
  if (!BUNDLE_URL.test(marker.source)) {
    return {
      store: new PatternStore(join(resolve(projectDir), marker.source)),
      name: marker.pattern,
    };
  }
  const fetched = new PatternStore(
    join(tmpdir(), "dolly-sources", createHash("sha256").update(marker.source).digest("hex")),
  );
  const { name } = await importBundle(fetched, marker.source, { force: true });
  if (name !== marker.pattern) {
    throw new MarkerError(
      `${MARKER_FILE} names "${marker.pattern}", but the bundle at ${marker.source} holds "${name}".`,
    );
  }
  return { store: fetched, name };
}

/**
 * `dolly link`: writes the marker naming this pattern, keeping the ignore
 * list and rule settings a marker already there carries. With `vendorFrom`,
 * the pattern directory is copied into the project under VENDOR_DIR and the
 * marker's `source` points there; without it, any `source` is dropped, since
 * the machine's store is the pattern's home again. Returns the pattern it
 * replaced, when the project was linked to another one.
 */
export async function linkProject(
  projectDir: string,
  pattern: string,
  options: { vendorFrom?: PatternStore } = {},
): Promise<{ replaced?: string; vendored?: string }> {
  const root = resolve(projectDir);
  const previous = await readMarker(root);
  let vendored: string | undefined;
  if (options.vendorFrom) {
    await options.vendorFrom.load(pattern); // a vendored copy must be a valid pattern
    vendored = join(VENDOR_DIR, pattern);
    await rm(join(root, vendored), { recursive: true, force: true });
    await cp(options.vendorFrom.dirOf(pattern), join(root, vendored), { recursive: true });
  }
  await Bun.write(
    join(root, MARKER_FILE),
    markerContents({
      pattern,
      ...(vendored ? { source: VENDOR_DIR } : {}),
      ignore: previous?.ignore,
      rules: previous?.rules,
    }),
  );
  return {
    ...(previous && previous.pattern !== pattern ? { replaced: previous.pattern } : {}),
    ...(vendored ? { vendored } : {}),
  };
}

/** `dolly ignore`: adds paths to the marker's ignore list, once each; the marker must exist. */
export async function ignorePaths(projectDir: string, paths: string[]): Promise<Marker> {
  const marker = await readMarker(projectDir);
  if (!marker) {
    throw new MarkerError(`No ${MARKER_FILE} marker here; run \`dolly link <pattern>\` first.`);
  }
  const unsafe = paths.find((path) => !isSafePatternPath(path));
  if (unsafe) throw new MarkerError(`"${unsafe}" is not a relative path inside the project.`);
  const ignore = [...marker.ignore, ...paths.filter((path) => !marker.ignore.includes(path))];
  const updated = { ...marker, ignore };
  await Bun.write(join(resolve(projectDir), MARKER_FILE), markerContents(updated));
  return updated;
}
