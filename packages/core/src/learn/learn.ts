/**
 * Learning mode: a watcher that turns a project's drift into proposals the
 * pattern can adopt, one accepted change at a time.
 * The engine drafts and applies; deciding stays with the user, so nothing
 * here writes a pattern until it is handed the accepted list.
 */

import { watch } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { type PatternDocument, serializePatternDocument } from "../pattern/document";
import { isSafePatternPath, type LayoutEntry, patternSchema } from "../pattern/schema";
import { BANNED_KEYS, isPlainObject } from "../serialize";
import type { PatternStore } from "../store";
import { readIfExists } from "../tree/files";
import { comparePaths, DENY_DIRS } from "../tree/inventory";
import { unifiedDiff } from "./diff";
import { learnDrift, type Proposal } from "./drift";

export { learnDrift, type Proposal, pathLabel } from "./drift";

const NOTES_HEADING = "## Extraction notes";

/** The document as it would read with these proposals adopted; the input is left untouched. */
export function draftDocument(doc: PatternDocument, proposals: Proposal[]): PatternDocument {
  const pattern = structuredClone(doc.pattern) as Record<string, unknown>;
  let prose = doc.prose;
  for (const proposal of proposals) {
    const head = proposal.path[0];
    if (head === "prose") prose = withConvention(prose, String(proposal.value));
    else if (head === "layout") {
      const layout = [...(pattern.layout as LayoutEntry[]), proposal.value as LayoutEntry];
      pattern.layout = layout.sort((a, b) => comparePaths(a.path, b.path));
    } else setAt(pattern, proposal.path, proposal.value);
  }
  return { pattern: patternSchema.parse(pattern), prose };
}

/**
 * One proposal as the unified diff it would make: to pattern.md, or, for a
 * captured config whose bytes moved, to the captured file itself.
 */
export async function renderProposal(
  store: PatternStore,
  doc: PatternDocument,
  proposal: Proposal,
): Promise<string> {
  const [relPath, contents] = Object.entries(proposal.files ?? {})[0] ?? [];
  if (relPath !== undefined && contents !== undefined && proposal.before !== undefined) {
    const held = (await store.fileOf(doc.pattern.name, relPath).then(readIfExists, () => "")) ?? "";
    return `${relPath}\n${unifiedDiff(held, contents)}`;
  }
  return unifiedDiff(
    serializePatternDocument(doc),
    serializePatternDocument(draftDocument(doc, [proposal])),
  );
}

/** A captured path that would leave the pattern directory; proposals can arrive over the daemon's wire. */
export class UnsafePatternPathError extends Error {
  override name = "UnsafePatternPathError";
}

/** Writes the accepted proposals into the pattern, captured config bytes included. */
export async function saveLearned(
  store: PatternStore,
  patternName: string,
  accepted: Proposal[],
): Promise<void> {
  const captures = accepted.flatMap((p) => Object.entries(p.files ?? {}));
  const escaping = captures.find(([relPath]) => !isSafePatternPath(relPath));
  if (escaping) {
    throw new UnsafePatternPathError(
      `A captured file path must stay inside the pattern: ${escaping[0]}`,
    );
  }
  // Resolved before anything is written: a symlink under a vendored pattern refuses the whole save.
  const targets: [string, string][] = [];
  for (const [relPath, contents] of captures) {
    const target = await store.fileOf(patternName, relPath).catch(() => {
      throw new UnsafePatternPathError(
        `A captured file path must stay inside the pattern: ${relPath}`,
      );
    });
    targets.push([target, contents]);
  }
  const doc = await store.load(patternName);
  await store.save(draftDocument(doc, accepted));
  for (const [target, contents] of targets) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
}

export interface LearningWatch {
  /** Every project file that changed so far, sorted. */
  changed(): string[];
  /** Stops watching and returns the final changed list. */
  stop(): string[];
}

/**
 * Re-learns the project whenever it settles, reporting the proposals each
 * time. The changed-file list it keeps is the session's evidence for the
 * AI layer's convention drafting, collected once at the end.
 */
export function watchLearning(
  store: PatternStore,
  patternName: string,
  projectDir: string,
  onDrift: (proposals: Proposal[]) => void,
  onError: (error: unknown) => void,
): LearningWatch {
  const root = resolve(projectDir);
  const changed = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => learnDrift(store, patternName, root).then(onDrift, onError);
  void run();
  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    const relative = (filename?.toString() ?? "").split("\\").join("/");
    const top = relative.split("/")[0] ?? "";
    if (top === ".git" || DENY_DIRS.has(top)) return;
    if (relative) changed.add(relative);
    clearTimeout(timer);
    timer = setTimeout(run, 800); // extraction walks the whole tree; give edits room to settle
  });
  const changedSoFar = () => [...changed].sort(comparePaths);
  return {
    changed: changedSoFar,
    stop() {
      clearTimeout(timer);
      watcher.close();
      return changedSoFar();
    },
  };
}

/** Sets a nested value by segments; keys may hold dots, so no dotted-path helper will do. */
function setAt(target: Record<string, unknown>, path: string[], value: unknown): void {
  const banned = path.find((key) => BANNED_KEYS.has(key));
  if (banned) throw new UnsafePatternPathError(`A proposal may not set "${banned}".`);
  let node = target;
  for (const key of path.slice(0, -1)) {
    if (!isPlainObject(node[key])) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[path[path.length - 1] as string] = value;
}

/** A convention line joins the prose under the author's own words, above the extraction notes. */
function withConvention(prose: string, line: string): string {
  const bullet = `- ${line.trim()}`;
  const at = prose.indexOf(NOTES_HEADING);
  const head = (at === -1 ? prose : prose.slice(0, at)).trimEnd();
  if (!head) return at === -1 ? bullet : `${bullet}\n\n${prose.slice(at)}`;
  // A list continues on the next line; the first bullet opens one with a blank line.
  const joined = `${head}\n${/\n- [^\n]*$/.test(`\n${head}`) ? "" : "\n"}${bullet}`;
  return at === -1 ? joined : `${joined}\n\n${prose.slice(at)}`;
}
