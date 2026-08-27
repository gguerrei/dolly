import { join, resolve } from "node:path";

/**
 * The `.dolly` marker: one committed line linking a project to its pattern.
 * It is a contract between two stages (`new` writes it, `check` resolves
 * the pattern from it), so both import it from here rather than owning it.
 */
export const MARKER_FILE = ".dolly";

export function markerContents(patternName: string): string {
  return `pattern: ${patternName}\n`;
}

export async function readPatternMarker(projectDir: string): Promise<string | undefined> {
  const file = Bun.file(join(resolve(projectDir), MARKER_FILE));
  if (!(await file.exists())) return undefined;
  return (await file.text()).match(/^pattern:[ \t]*([a-z0-9][a-z0-9-]*)[ \t]*$/m)?.[1];
}
