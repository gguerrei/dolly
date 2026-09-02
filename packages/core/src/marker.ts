import { join, resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { isSafePatternPath, patternSchema } from "./pattern/schema";

/**
 * The `.dolly` marker: a committed YAML file linking a project to its
 * pattern. `new` and `link` write it, check and fit resolve the pattern
 * from it, and its `ignore` list is the project's own word on which paths
 * check leaves alone (a mandated kebab-case script in a snake_case repo, a
 * legacy file nobody may rename), so a known violation cannot fail CI
 * forever. Entries are relative paths with `*` and `**`; a directory entry
 * covers everything under it.
 */
export const MARKER_FILE = ".dolly";

export interface Marker {
  pattern: string;
  ignore: string[];
}

const markerSchema = z.strictObject({
  pattern: patternSchema.shape.name,
  ignore: z
    .array(z.string().refine(isSafePatternPath, "ignore entries are relative paths"))
    .default([]),
});

export class MarkerError extends Error {
  override name = "MarkerError";
}

export function markerContents(pattern: string, ignore: string[] = []): string {
  return stringifyYaml(ignore.length > 0 ? { pattern, ignore } : { pattern });
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

/**
 * `dolly link`: writes the marker naming this pattern, keeping the ignore
 * list a marker already there carries. Returns the pattern it replaced,
 * when the project was linked to another one.
 */
export async function linkProject(
  projectDir: string,
  pattern: string,
): Promise<{ replaced?: string }> {
  const previous = await readMarker(projectDir);
  await Bun.write(
    join(resolve(projectDir), MARKER_FILE),
    markerContents(pattern, previous?.ignore ?? []),
  );
  return previous && previous.pattern !== pattern ? { replaced: previous.pattern } : {};
}
