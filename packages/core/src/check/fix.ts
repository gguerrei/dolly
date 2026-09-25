import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { applyEdits, modify } from "jsonc-parser";
import { unifiedDiff } from "../learn/diff";
import { BANNED_KEYS, getDeep, isPlainObject, serializeByExtension, setDeep } from "../serialize";
import { pathWithin } from "../tree/files";
import { deepEqual, parseLoose } from "./support";

/**
 * A fix is data, not a closure; the one executor below interprets it. This
 * is what lets a `CheckReport` travel as JSON (the daemon, fit's dry-run
 * diff) while the write behavior stays in exactly one place. Three verbs
 * plus one explicit exception, mirroring docs/design/check.md: fixes only
 * ever create, append, or merge; `write` exists solely for a config the
 * pattern binds `verbatim`, the one overwrite a user opts into by name.
 */
export type FixPlan =
  | {
      /** Writes a file that does not exist; refuses one that does, since the disk decides absence. */
      kind: "create";
      path: string;
      contents: string;
    }
  | {
      /** Overwrites in place. Only the `verbatim` config binding plans this. */
      kind: "write";
      path: string;
      contents: string;
    }
  | {
      /** Appends after the current contents (creating the file when missing). */
      kind: "append";
      path: string;
      text: string;
      /** Skip entirely when some line's trimmed text equals this, the idempotence guard. */
      skipIfLine?: string;
    }
  | {
      /** Parse → captured keys win, project extras survive → reserialize. */
      kind: "merge";
      path: string;
      value: unknown;
      /** Dotted path to merge at (`tool.ruff`); whole document when absent. */
      at?: string;
    };

/**
 * "skipped" means the guard held: the file already existed, or the line was
 * already there. Callers must not report a skipped fix as performed.
 */
export type FixOutcome = "applied" | "skipped";

/** The one place a fix touches the disk: never through a symlink, never out of the project. */
export async function applyFix(root: string, plan: FixPlan): Promise<FixOutcome> {
  const target = await pathWithin(root, plan.path);
  switch (plan.kind) {
    case "create": {
      await mkdir(dirname(target), { recursive: true });
      try {
        await writeFile(target, plan.contents, { flag: "wx" }); // the disk decides absence, atomically
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") return "skipped";
        throw error;
      }
      return "applied";
    }
    case "write": {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, plan.contents);
      return "applied";
    }
    case "append": {
      const file = Bun.file(target);
      const current = (await file.exists()) ? await file.text() : "";
      const next = appendedText(current, plan);
      if (next === current) return "skipped";
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, next);
      return "applied";
    }
    case "merge": {
      const file = Bun.file(target);
      const currentText = (await file.exists()) ? await file.text() : undefined;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, mergedText(currentText, plan));
      return "applied";
    }
  }
}

/**
 * The file as a plan would leave it, without touching the disk: what fit
 * shows before apply, and what apply then writes. A create over a file
 * that exists, or an append whose guard holds, leaves the text as it is.
 */
export async function plannedText(root: string, plan: FixPlan): Promise<string> {
  const file = Bun.file(join(root, plan.path));
  const exists = await file.exists();
  const current = exists ? await file.text() : "";
  switch (plan.kind) {
    case "create":
      return exists ? current : plan.contents;
    case "write":
      return plan.contents;
    case "append":
      return appendedText(current, plan);
    case "merge":
      return mergedText(exists ? current : undefined, plan);
  }
}

/** The patch a plan would make, as a unified diff; empty when it would change nothing. */
export async function previewFix(root: string, plan: FixPlan): Promise<string> {
  const file = Bun.file(join(root, plan.path));
  const current = (await file.exists()) ? await file.text() : "";
  const next = await plannedText(root, plan);
  // A file that ends in a newline splits into a trailing empty line, which
  // the diff would print as one blank context line at the end; drop it.
  return next === current ? "" : unifiedDiff(current, next).replace(/\n {2}$/, "");
}

function appendedText(current: string, plan: Extract<FixPlan, { kind: "append" }>): string {
  if (
    plan.skipIfLine !== undefined &&
    current.split("\n").some((line) => line.trim() === plan.skipIfLine)
  ) {
    return current;
  }
  const sep = current === "" || current.endsWith("\n") ? "" : "\n";
  return `${current}${sep}${plan.text}`;
}

function mergedText(
  currentText: string | undefined,
  plan: Extract<FixPlan, { kind: "merge" }>,
): string {
  // An existing JSON/JSONC file merges as minimal text edits: captured
  // keys land, everything else (comments, tabs, key order, the author's
  // whole shape) stands untouched.
  if (currentText !== undefined && !/\.toml$/i.test(plan.path)) {
    const parsed = parseLoose(plan.path, currentText);
    if (isPlainObject(parsed)) {
      const base = plan.at === undefined ? [] : plan.at.split(".");
      const start = plan.at === undefined ? parsed : getDeep(parsed, plan.at);
      let text = currentText;
      for (const edit of minimalEdits(start, plan.value, base)) {
        text = applyEdits(
          text,
          modify(text, edit.path, edit.value, { formattingOptions: formattingOf(text) }),
        );
      }
      return text;
    }
  }
  // TOML, a missing file, or an unparseable one: the whole-document path.
  const parsed = currentText === undefined ? {} : (parseLoose(plan.path, currentText) ?? {});
  const node = isPlainObject(parsed) ? parsed : {};
  if (plan.at === undefined) {
    return serializeByExtension(
      plan.path,
      mergeCaptured(plan.value, node) as Record<string, unknown>,
    );
  }
  setDeep(node, plan.at, mergeCaptured(plan.value, getDeep(node, plan.at)));
  return serializeByExtension(plan.path, node);
}

/**
 * The assignments a merge needs, and nothing more: captured objects recurse
 * so project extras survive; anything else assigns at its path (creating
 * missing parents); keys already equal produce no edit at all.
 */
function minimalEdits(
  current: unknown,
  captured: unknown,
  path: string[],
): { path: string[]; value: unknown }[] {
  if (isPlainObject(captured) && isPlainObject(current)) {
    const edits: { path: string[]; value: unknown }[] = [];
    for (const [key, value] of Object.entries(captured)) {
      if (BANNED_KEYS.has(key)) continue;
      edits.push(...minimalEdits(current[key], value, [...path, key]));
    }
    return edits;
  }
  if (deepEqual(current, captured)) return [];
  if (path.length === 0) return []; // a non-object at the root has no path to edit
  return [{ path, value: structuredClone(captured) }];
}

/** Match the file's own indentation; jsonc edits must not bring a second style. */
function formattingOf(text: string): { insertSpaces: boolean; tabSize: number; eol: string } {
  const indent = text.match(/^[ \t]+/m)?.[0] ?? "  ";
  return indent.includes("\t")
    ? { insertSpaces: false, tabSize: 4, eol: "\n" }
    : { insertSpaces: true, tabSize: indent.length, eol: "\n" };
}

/**
 * Two rules can aim a create at the same path, layout's stub and config's
 * captured bytes both filling the same hole. Executing both would let
 * whichever runs first win (and the executor's guard would silently no-op
 * the other), so the plans are reconciled first: per path, the create with
 * contents beats the stub. Returns the losers: steps to skip, not report.
 */
export function losingCreates<T extends { fix?: FixPlan }>(items: T[]): Set<T> {
  const winners = new Map<string, T>();
  for (const item of items) {
    if (item.fix?.kind !== "create") continue;
    const current = winners.get(item.fix.path);
    const currentLength = current?.fix?.kind === "create" ? current.fix.contents.length : -1;
    if (item.fix.contents.length > currentLength) winners.set(item.fix.path, item);
  }
  const losers = new Set<T>();
  for (const item of items) {
    if (item.fix?.kind === "create" && winners.get(item.fix.path) !== item) losers.add(item);
  }
  return losers;
}

/** Captured keys win where they conflict; project extras survive untouched. */
function mergeCaptured(captured: unknown, project: unknown): unknown {
  if (isPlainObject(captured) && isPlainObject(project)) {
    const merged: Record<string, unknown> = { ...project };
    for (const [key, value] of Object.entries(captured)) {
      if (BANNED_KEYS.has(key)) continue;
      merged[key] = mergeCaptured(value, project[key]);
    }
    return merged;
  }
  return structuredClone(captured);
}
