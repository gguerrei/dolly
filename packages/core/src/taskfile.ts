/**
 * The taskfile dialects dolly reads and writes (name candidates, indent,
 * the recipe scan, and the fresh-file renderer) in one place, so extract
 * (learning commands from a repo) and check (verifying them) can never
 * drift apart on what a recipe is.
 */

export type TaskRunnerFile = "just" | "make";

export const TASKFILE_NAMES: Record<TaskRunnerFile, string[]> = {
  just: ["justfile", ".justfile", "Justfile"],
  make: ["Makefile", "makefile", "GNUmakefile"],
};

export const TASKFILE_INDENT: Record<TaskRunnerFile, string> = { just: "  ", make: "\t" };

export interface Recipe {
  name: string;
  /** Between the name and the colon: parameters (just), target extras (make). */
  params: string;
  /** After the colon on the header line: dependencies (just), prerequisites (make). */
  rest: string;
  /** Trimmed body lines. Blank lines do not end a body in either dialect. */
  body: string[];
}

/**
 * Every recipe in the file, in order. A leading `@` marks a quiet recipe in
 * just and is part of the name's spelling, not the name; make gives `@` no
 * target-level meaning, so there it stays an ordinary non-match.
 */
export function scanRecipes(text: string, runner: TaskRunnerFile): Recipe[] {
  const headerRe =
    runner === "just"
      ? /^@?([A-Za-z][\w-]*)([^:=\n]*):(?!=)(.*)$/
      : /^([A-Za-z][\w-]*)([^:=\n]*):(?!=)(.*)$/;
  const lines = text.split("\n");
  const recipes: Recipe[] = [];
  for (let i = 0; i < lines.length; i++) {
    const header = (lines[i] as string).match(headerRe);
    if (!header) continue;
    const [, name, params, rest] = header as unknown as [string, string, string, string];
    const body: string[] = [];
    let end = i;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j] as string;
      if (/^[ \t]*$/.test(line)) continue;
      if (!/^[ \t]+\S/.test(line)) break;
      body.push(line.trim());
      end = j;
    }
    i = end;
    recipes.push({ name, params: params.trim(), rest: rest.trim(), body });
  }
  return recipes;
}

/** Renders commands as a fresh taskfile; the scaffolder and check's create-fix share it. */
export function taskfile(commands: Record<string, string>, indent: string): string {
  return `${Object.entries(commands)
    .map(([verb, command]) => `${verb}:\n${indent}${command}`)
    .join("\n\n")}\n`;
}
