import { createHash } from "node:crypto";
import { cp, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { RULE_IDS, type RuleId } from "./check/rule";
import { importBundle } from "./export/bundle";
import { isSafePatternPath, patternSchema } from "./pattern/schema";
import { dollyHome, PatternStore } from "./store";

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

/** Where the bundles a marker's `source` URL names are kept between runs, under the dolly home. */
export const SOURCES_DIR = "sources";

export const SOURCE_TUNING = {
  /** A fetched copy younger than this is read again instead of fetched again. */
  reuseMs: 60 * 60 * 1000,
  /** `dolly home --prune` removes copies older than this. */
  staleMs: 7 * 24 * 60 * 60 * 1000,
};

export type RuleSetting = "off" | "warn";

export interface Marker {
  pattern: string;
  /** A project-relative directory in the store's layout, or a URL to a .dolly bundle. */
  source?: string;
  /** The bundle's sha256, when `source` is a URL: it must hash to this or it is not read. */
  sha256?: string;
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
  sha256: z
    .string()
    .regex(/^[A-Fa-f0-9]{64}$/, "sha256 is the bundle's hash, 64 hex characters")
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
  sha256?: string;
  ignore?: string[];
  rules?: Partial<Record<RuleId, RuleSetting>>;
}): string {
  return stringifyYaml({
    pattern: marker.pattern,
    ...(marker.source ? { source: marker.source } : {}),
    ...(marker.sha256 ? { sha256: marker.sha256 } : {}),
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
 * is fetched under the dolly home under the same caps as `dolly import`,
 * a copy younger than an hour read again instead. Undefined when nothing
 * names a pattern.
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
  return { store: await fetchedSource(marker.source, marker), name: marker.pattern };
}

/**
 * The store a `source` URL is fetched into: one directory per URL and pin
 * under `<home>/sources/`, stamped with the time of the fetch, so the
 * hour's checks read one fetch and a changed pin never reads an old copy.
 */
async function fetchedSource(url: string, marker: Marker): Promise<PatternStore> {
  const key = createHash("sha256")
    .update(`${url}\n${marker.sha256 ?? ""}`)
    .digest("hex");
  const dir = join(dollyHome(), SOURCES_DIR, key);
  const store = new PatternStore(join(dir, "patterns"));
  const stamp = join(dir, "fetched");
  const age = await ageOf(stamp);
  if (age !== undefined && age <= SOURCE_TUNING.reuseMs && (await store.has(marker.pattern))) {
    return store;
  }
  const { name } = await importBundle(store, url, {
    force: true,
    ...(marker.sha256 ? { sha256: marker.sha256 } : {}),
  });
  if (name !== marker.pattern) {
    throw new MarkerError(
      `${MARKER_FILE} names "${marker.pattern}", but the bundle at ${url} holds "${name}".`,
    );
  }
  await Bun.write(stamp, `${url}\n`);
  return store;
}

/** `dolly home --prune`: removes the fetched sources older than a week, and returns their URLs. */
export async function pruneSources(): Promise<string[]> {
  const root = join(dollyHome(), SOURCES_DIR);
  const removed: string[] = [];
  for (const entry of await readdir(root).catch(() => [] as string[])) {
    const stamp = join(root, entry, "fetched");
    const age = await ageOf(stamp);
    if (age !== undefined && age <= SOURCE_TUNING.staleMs) continue;
    // No stamp means a fetch that never finished: gone too, named by its directory.
    const url = age === undefined ? entry : (await Bun.file(stamp).text()).trim();
    await rm(join(root, entry), { recursive: true, force: true });
    removed.push(url);
  }
  return removed.sort();
}

/** Milliseconds since the file was last written, undefined without the file. */
async function ageOf(path: string): Promise<number | undefined> {
  const info = await stat(path).catch(() => undefined);
  return info && Date.now() - info.mtimeMs;
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
    vendored = `${VENDOR_DIR}/${pattern}`; // the marker's own separator, whatever the platform's
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

/** The marker's own word, as `dolly ignore`, `dolly rules` and the check view's panel replace it. */
export interface MarkerEdit {
  ignore?: string[];
  rules?: Partial<Record<RuleId, RuleSetting>>;
}

/**
 * The marker with its ignore list or its rule settings replaced whole,
 * validated the way a read is and written; the pattern and its source
 * stay as they were. The marker must exist.
 */
export async function editMarker(projectDir: string, edit: MarkerEdit): Promise<Marker> {
  const marker = await existingMarker(projectDir);
  const unsafe = edit.ignore?.find((path) => !isSafePatternPath(path));
  if (unsafe) throw new MarkerError(`"${unsafe}" is not a relative path inside the project.`);
  const parsed = markerSchema.safeParse({
    ...marker,
    ...(edit.ignore ? { ignore: [...new Set(edit.ignore)] } : {}),
    ...(edit.rules ? { rules: edit.rules } : {}),
  });
  if (!parsed.success) {
    throw new MarkerError(`Not a valid marker edit:\n${z.prettifyError(parsed.error)}`);
  }
  await Bun.write(join(resolve(projectDir), MARKER_FILE), markerContents(parsed.data));
  return parsed.data;
}

/** `dolly ignore`: paths added to the marker's ignore list, once each, or taken off it with `remove`. */
export async function ignorePaths(
  projectDir: string,
  paths: string[],
  options: { remove?: boolean } = {},
): Promise<Marker> {
  const { ignore } = await existingMarker(projectDir);
  return editMarker(projectDir, {
    ignore: options.remove ? ignore.filter((path) => !paths.includes(path)) : [...ignore, ...paths],
  });
}

async function existingMarker(projectDir: string): Promise<Marker> {
  const marker = await readMarker(projectDir);
  if (!marker) {
    throw new MarkerError(`No ${MARKER_FILE} marker here; run \`dolly link <pattern>\` first.`);
  }
  return marker;
}
