import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { checkProject } from "../check/check";
import { applyFix, type FixPlan, losingCreates } from "../check/fix";
import type { Violation } from "../check/rule";
import { nameRegex } from "../check/rules/layout";
import { primaryExtensionOf } from "../extract/languages";
import { extensionOf, renderStem } from "../extract/naming";
import { filePatternOf, placementOf, TEST_ROOT_NAMES, testStemOf } from "../extract/testing";
import type { CaseStyle, Pattern } from "../pattern/schema";
import { slugify } from "../pattern/schema";
import type { PatternStore } from "../store";
import { runGit } from "../tree/git";
import { collectInventory } from "../tree/inventory";
import {
  BLIND_IMPORTERS,
  type ImportRewrite,
  planRewrites,
  rewriteSpecifiers,
  SOURCE_FILE,
  scanImports,
} from "./imports";

/**
 * `dolly fit`: the migration planner (docs/design/fit.md). Plans in check's
 * currency (every fixable violation's FixPlan adopted verbatim) plus the
 * step kind check refuses: `move`, each carrying the import rewrites that
 * keep the tree compiling. The plan is data end to end; a move that cannot
 * account for itself is declined with its reason, never half-applied.
 */

export interface FixStep {
  kind: "fix";
  path: string;
  /** check's own message, the reason this step exists. */
  reason: string;
  plan: FixPlan;
}

export interface MoveStep {
  kind: "move";
  from: string;
  /** Trailing "/" marks a directory move, as everywhere in dolly. */
  to: string;
  reason: string;
  rewrites: ImportRewrite[];
}

/**
 * A file the pattern's languages rule would have written in another
 * language (docs/design/translation.md, ADR-0004). Planned only with the
 * AI layer on; under apply, the model fills in the bytes and the pattern's
 * own commands judge them before the source is removed.
 */
export interface TranslateStep {
  kind: "translate";
  from: string;
  to: string;
  /** The target language, the pattern's dominant one. */
  language: string;
  reason: string;
  /** The source's size, so the dry run can say what would go to the model. */
  bytes: number;
}

export type FitStep = FixStep | MoveStep | TranslateStep;

/** ADR-0004's bounds: what one apply may send to the model. */
const TRANSLATE_MAX_FILES = 25;
const TRANSLATE_MAX_BYTES = 64 * 1024;

export interface FitOptions {
  /** Plan translate steps; false (the default, and the AI-off case) declines them with the connect hint. */
  translate?: boolean;
}

/** Attached by the AI layer only; apply never reads it (ground rule 3 in docs/design/ai.md). */
export interface PlacementSuggestion {
  pick: string;
  why: string;
  model: string;
}

export interface DeclinedItem {
  path: string;
  message: string;
  /**
   * Present when the decline is an ambiguity between concrete destinations
   * the planner enumerated itself. This is the whole opening the AI layer
   * gets: choosing among these, never inventing a path.
   */
  candidates?: string[];
  suggestion?: PlacementSuggestion;
}

export interface FitPlan {
  pattern: string;
  steps: FitStep[];
  /** What fit will not do, each with the reason. */
  declined: DeclinedItem[];
  /** Pattern defects, straight from check. */
  diagnostics: string[];
}

export class FitGitError extends Error {
  override name = "FitGitError";
}

export async function fitProject(
  store: PatternStore,
  patternName: string,
  projectDir: string,
  options: FitOptions = {},
): Promise<FitPlan> {
  const root = resolve(projectDir);
  const report = await checkProject(store, patternName, root);
  const { pattern } = await store.load(patternName);
  const inventory = await collectInventory(root);
  const files = new Set(inventory.files.map((f) => f.path));
  const dirs = new Set(inventory.dirs);

  const steps: FitStep[] = [];
  const declined: DeclinedItem[] = [];
  const translations = new Set<string>(); // target paths claimed so far
  const decline = (path: string, message: string, candidates?: string[]) =>
    declined.push({ path, message, ...(candidates ? { candidates } : {}) });

  /** from → proposed move; built first, thinned by every guard below. */
  const proposals = new Map<string, { to: string; reason: string; dir: boolean }>();
  const propose = (from: string, to: string, reason: string, dir: boolean) => {
    if (to === from) {
      decline(from, `${reason}, but no mechanical rename resolves it`);
      return;
    }
    if (proposals.has(from)) {
      decline(from, "two rules want to move this; apply this plan, then run fit again");
      return;
    }
    proposals.set(from, { to, reason, dir });
  };

  // Layout's stub and config's captured bytes can both aim a create at one
  // path; only the winner (contents beat stubs) becomes a step.
  const subsumed = losingCreates(report.violations);
  for (const violation of report.violations) {
    if (violation.fix) {
      if (!subsumed.has(violation)) {
        steps.push({
          kind: "fix",
          path: violation.path,
          reason: violation.message,
          plan: violation.fix,
        });
      }
      continue;
    }
    if (violation.rule === "naming") {
      const move = namingMove(violation, pattern);
      if (move) propose(move.from, move.to, violation.message, move.dir);
      else decline(violation.path, violation.message);
      continue;
    }
    if (violation.rule === "testing") {
      // A path the pattern's own layout demands is not misplaced. Moving it
      // would contradict the pattern; that conflict is the author's to settle.
      const demanded = pattern.layout.find((entry) =>
        entry.path.includes("{name}")
          ? nameRegex(entry.path).test(violation.path)
          : entry.path === violation.path,
      );
      if (demanded) {
        decline(
          violation.path,
          `${violation.message}, but the pattern's layout demands "${demanded.path}", so the testing facet contradicts it; settle the pattern first`,
        );
        continue;
      }
      const move = testingMove(
        violation.path,
        pattern,
        inventory.files.map((f) => f.path),
        inventory.dirs,
      );
      if ("to" in move) propose(violation.path, move.to, violation.message, false);
      else decline(violation.path, `${violation.message}: ${move.declined}`, move.candidates);
      continue;
    }
    if (violation.rule === "languages") {
      const step = translation(violation, pattern, inventory.files, options, translations.size);
      if (!("to" in step)) decline(violation.path, `${violation.message}: ${step.declined}`);
      else if (files.has(step.to) || translations.has(step.to)) {
        // Two sources with one stem (release.py, release.sh) cannot both become release.ts.
        decline(
          violation.path,
          `${violation.message}, but ${step.to} already exists (or two translations collide there)`,
        );
      } else {
        steps.push(step);
        translations.add(step.to);
      }
      continue;
    }
    declined.push({ path: violation.path, message: violation.message });
  }

  // Ground rule 4, enforced for real: the import ledger reads TS/JS-family
  // importers only, so a move it cannot see is a move it cannot account
  // for. A Python module's importers, a markdown link, a CI script reference
  // are all invisible, and "no importers found" must never read as
  // "accounted for". Same logic when the tree carries importer types the
  // ledger cannot open yet (.vue, .svelte, …): every move is unaccountable.
  const blind = inventory.files.find((f) => BLIND_IMPORTERS.test(f.path))?.path;
  for (const [from, proposal] of [...proposals]) {
    const movedFiles = proposal.dir ? [...files].filter((f) => f.startsWith(`${from}/`)) : [from];
    const outside = movedFiles.find((f) => !SOURCE_FILE.test(f));
    if (outside !== undefined) {
      proposals.delete(from);
      decline(
        from,
        `${proposal.reason}, but dolly cannot yet account for references to ${extensionLabel(outside)} files, so this move is yours to make`,
      );
      continue;
    }
    if (blind !== undefined) {
      proposals.delete(from);
      decline(
        from,
        `${proposal.reason}, but the tree has ${extensionLabel(blind)} files whose imports dolly cannot yet read, so this move is yours to make`,
      );
    }
  }

  // A move touching a directory that is itself moving waits for the next
  // run, whether the move starts inside it or would land inside it (the
  // rename happens first, and a later mkdir would resurrect the old name).
  for (const [from, proposal] of [...proposals]) {
    const conflicting = [...proposals].find(
      ([other, p]) =>
        p.dir &&
        other !== from &&
        (from.startsWith(`${other}/`) || proposal.to.startsWith(`${other}/`)),
    );
    if (conflicting) {
      proposals.delete(from);
      decline(
        from,
        `${proposal.reason}, but ${conflicting[0]}/ is being renamed in this same plan; run fit again after`,
      );
    }
  }

  // Collisions: with the tree, with the disk, with paths the plan's own fix
  // steps will create, and among the moves themselves.
  const fixTargets = new Set(
    steps.flatMap((s) =>
      s.kind === "fix" && (s.plan.kind === "create" || s.plan.kind === "write")
        ? [s.plan.path]
        : [],
    ),
  );
  const targets = new Map<string, string[]>();
  for (const [from, { to }] of proposals) {
    targets.set(to, [...(targets.get(to) ?? []), from]);
  }
  for (const [from, proposal] of [...proposals]) {
    const { to } = proposal;
    const underTo = (path: string) => path === to || (proposal.dir && path.startsWith(`${to}/`));
    const clash =
      (targets.get(to) as string[]).length > 1 ||
      (proposal.dir ? dirs.has(to) : files.has(to)) ||
      [...fixTargets].some(underTo) ||
      (await collides(root, from, to));
    if (clash) {
      proposals.delete(from);
      decline(from, `${proposal.reason}, but ${to} already exists (or two steps collide there)`);
    }
  }

  // Expand directory moves to per-file mappings for the import ledger.
  const buildMapping = () => {
    const moved = new Map<string, string>();
    for (const [from, { to, dir }] of proposals) {
      if (!dir) {
        moved.set(from, to);
        continue;
      }
      for (const file of files) {
        if (file.startsWith(`${from}/`)) moved.set(file, `${to}/${file.slice(from.length + 1)}`);
      }
    }
    return moved;
  };

  const scan = await scanImports(
    root,
    inventory.files.map((f) => f.path),
  );
  for (const ambiguity of scan.ambiguous) {
    for (const [from, proposal] of [...proposals]) {
      const span = (path: string) => path === from || (proposal.dir && path.startsWith(`${from}/`));
      const involved =
        span(ambiguity.file) || ambiguity.candidates.some((candidate) => span(candidate));
      if (involved) {
        proposals.delete(from);
        decline(
          from,
          `${proposal.reason}, but "${ambiguity.spec}" in ${ambiguity.file} resolves ambiguously, so the move cannot account for it`,
        );
      }
    }
  }
  const moved = buildMapping();
  const rewrites = planRewrites(scan.edges, moved);

  // A move claims every rewrite whose importer or resolved target it spans;
  // target moves claim first, so a rewrite is listed exactly once.
  const claimed = new Set<ImportRewrite>();
  const sorted = [...proposals].sort(([a], [b]) => (a < b ? -1 : 1));
  const claim = (from: string, dir: boolean, byTarget: boolean) => {
    const span = (path: string) =>
      dir ? path === from || path.startsWith(`${from}/`) : path === from;
    return rewrites.filter((rewrite) => {
      if (claimed.has(rewrite)) return false;
      if (!(byTarget ? span(rewrite.target) : span(rewrite.file))) return false;
      claimed.add(rewrite);
      return true;
    });
  };
  const own = new Map<string, ImportRewrite[]>();
  for (const [from, { dir }] of sorted) own.set(from, claim(from, dir, true));
  for (const [from, { dir }] of sorted) {
    own.set(from, [...(own.get(from) ?? []), ...claim(from, dir, false)]);
  }
  for (const [from, { to, reason, dir }] of sorted) {
    steps.push({
      kind: "move",
      from: dir ? `${from}/` : from,
      to: dir ? `${to}/` : to,
      reason,
      rewrites: own.get(from) ?? [],
    });
  }

  return { pattern: patternName, steps, declined, diagnostics: report.diagnostics };
}

function namingMove(
  violation: Violation,
  pattern: Pattern,
): { from: string; to: string; dir: boolean } | undefined {
  const naming = pattern.naming;
  if (!naming) return undefined;
  const isDir = violation.path.endsWith("/");
  if (isDir) {
    const from = violation.path.slice(0, -1);
    const style = naming.directories;
    if (!style) return undefined;
    const name = basename(from);
    const parent = parentOf(from);
    return { from, to: joinRel(parent, renderJudged(name, style)), dir: true };
  }
  const from = violation.path;
  const base = basename(from);
  const dot = base.indexOf(".");
  const stem = dot === -1 ? base : base.slice(0, dot);
  const suffix = dot === -1 ? "" : base.slice(dot);
  const style: CaseStyle | undefined =
    (extensionOf(base) ? naming.extensions[extensionOf(base) as string] : undefined) ??
    naming.files;
  if (!style) return undefined;
  return { from, to: joinRel(parentOf(from), renderJudged(stem, style) + suffix), dir: false };
}

/**
 * Renders only the portion of a stem check actually judged: normalizeStem
 * exempts underscore affixes and a `_test`/`_spec` suffix from the vote, so
 * a rename must leave them standing: `my_thing_test` under kebab-case
 * becomes `my-thing_test` (still a test to every tool that greps for one),
 * and `_app` under PascalCase keeps its framework-mandated underscore.
 */
function renderJudged(stem: string, style: CaseStyle): string {
  const lead = stem.match(/^_+/)?.[0] ?? "";
  const trail = stem.length > lead.length ? (stem.match(/_+$/)?.[0] ?? "") : "";
  const inner = stem.slice(lead.length, stem.length - trail.length);
  const suffix = inner.match(/_(test|spec)$/)?.[0] ?? "";
  const core = suffix === "" ? inner : inner.slice(0, -suffix.length);
  if (core === "") return stem;
  return lead + renderStem(core, style) + suffix + trail;
}

function testingMove(
  path: string,
  pattern: Pattern,
  allFiles: string[],
  allDirs: string[],
): { to: string } | { declined: string; candidates?: string[] } {
  const testing = pattern.testing;
  if (!testing) return { declined: "the pattern carries no testing facet" };
  const stem = testStemOf(path);
  if (stem === undefined) return { declined: "its stem cannot be read" };
  const currentBase = basename(path);
  const targetBase = testing.filePattern
    ? testing.filePattern.replaceAll("{stem}", stem)
    : currentBase;

  if (placementOf(path) === testing.placement) return { to: joinRel(parentOf(path), targetBase) };

  if (testing.placement === "colocated") {
    const extension = currentBase.slice(currentBase.lastIndexOf("."));
    const sourceBase = `${stem}${extension}`;
    const sources = allFiles.filter(
      (f) => basename(f) === sourceBase && filePatternOf(f) === undefined,
    );
    if (sources.length === 0) {
      return { declined: `no source file named ${sourceBase} to sit next to` };
    }
    if (sources.length > 1) {
      return {
        declined: `${sources.length} files named ${sourceBase} make the destination ambiguous`,
        candidates: sources.map((source) => joinRel(parentOf(source), targetBase)).sort(),
      };
    }
    return { to: joinRel(parentOf(sources[0] as string), targetBase) };
  }

  // separate: the *nearest* test root wins. Walk the file's ancestors
  // outward, matching placementOf, which honors roots at any depth (a
  // monorepo's packages/api/tests/ beats a stray top-level one).
  const dirSet = new Set(allDirs);
  const fileDir = parentOf(path);
  const ancestors: string[] = [];
  for (let ancestor = fileDir; ; ancestor = parentOf(ancestor)) {
    ancestors.push(ancestor);
    if (ancestor === "") break;
  }
  for (const ancestor of ancestors) {
    const roots = [...TEST_ROOT_NAMES].filter((name) => dirSet.has(joinRel(ancestor, name)));
    if (roots.length === 0) continue;
    const destinationIn = (rootName: string): string => {
      const testRoot = joinRel(ancestor, rootName);
      let under = ancestor === "" ? fileDir : fileDir.slice(ancestor.length + 1);
      // src/ is scaffolding, not test taxonomy, so a leading src segment drops.
      if (under === "src") under = "";
      else if (under.startsWith("src/")) under = under.slice(4);
      const destination = under === "" ? testRoot : joinRel(testRoot, under);
      return joinRel(destination, targetBase);
    };
    if (roots.length > 1) {
      return {
        declined: `several test roots exist under ${ancestor === "" ? "the root" : `${ancestor}/`} (${roots.sort().join(", ")}), so the destination is ambiguous`,
        candidates: roots.sort().map(destinationIn),
      };
    }
    return { to: destinationIn(roots[0] as string) };
  }
  return { declined: "the project has no test directory yet; create one first" };
}

/** One languages violation as a translate step, or the reason it is not one (ADR-0004's bounds). */
function translation(
  violation: Violation,
  pattern: Pattern,
  files: { path: string; size: number }[],
  options: FitOptions,
  planned: number,
): TranslateStep | { declined: string } {
  if (!options.translate) {
    return { declined: "translation needs the AI layer; `dolly ai connect` turns it on" };
  }
  const language = pattern.languages?.programming?.[0];
  const extension = language ? primaryExtensionOf(language) : undefined;
  if (!language || !extension) {
    return { declined: "the pattern names no language dolly knows an extension for" };
  }
  if (planned >= TRANSLATE_MAX_FILES) {
    return {
      declined: `over the ${TRANSLATE_MAX_FILES} translations one apply allows; apply this plan, then run fit again`,
    };
  }
  const bytes = files.find((f) => f.path === violation.path)?.size ?? 0;
  if (bytes > TRANSLATE_MAX_BYTES) {
    return {
      declined: `${Math.round(bytes / 1024)} KiB is over the ${TRANSLATE_MAX_BYTES / 1024} KiB one translation allows`,
    };
  }
  const stem = violation.path.replace(/\.[^./]+$/, "");
  return {
    kind: "translate",
    from: violation.path,
    to: `${stem}${extension}`,
    language,
    reason: violation.message,
    bytes,
  };
}

/** Fills in a translated file's bytes: the model, behind the AI layer; absent, every translate step fails. */
export type Translator = (
  step: TranslateStep,
  plan: FitPlan,
  done: TranslateStep[],
) => Promise<string>;

/** Executes a plan: fixes, then rewrites, then moves, then translations, with each failure contained. */
export async function applyFitPlan(
  projectDir: string,
  plan: FitPlan,
  translator?: Translator,
): Promise<{ applied: string[]; failures: string[] }> {
  const root = resolve(projectDir);
  const applied: string[] = [];
  const failures: string[] = [];
  const attempt = async (label: string, action: () => Promise<void>) => {
    try {
      await action();
      applied.push(label);
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  for (const step of plan.steps) {
    if (step.kind !== "fix") continue;
    try {
      const outcome = await applyFix(root, step.plan);
      applied.push(
        `fix ${step.path}${outcome === "skipped" ? " (already satisfied, skipped)" : ""}`,
      );
    } catch (error) {
      failures.push(`fix ${step.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // All of one file's specifier rewrites land in one write, at its pre-move path.
  const byFile = new Map<string, ImportRewrite[]>();
  for (const step of plan.steps) {
    if (step.kind !== "move") continue;
    for (const rewrite of step.rewrites) {
      byFile.set(rewrite.file, [...(byFile.get(rewrite.file) ?? []), rewrite]);
    }
  }
  for (const [file, rewrites] of byFile) {
    await attempt(`rewrite imports in ${file}`, async () => {
      const absolute = join(root, file);
      await writeFile(absolute, rewriteSpecifiers(await Bun.file(absolute).text(), rewrites));
    });
  }

  // Directories first (shallow before deep), then files.
  const moves = plan.steps.filter((s): s is MoveStep => s.kind === "move");
  const ordered = [
    ...moves.filter((m) => m.from.endsWith("/")).sort((a, b) => depth(a.from) - depth(b.from)),
    ...moves.filter((m) => !m.from.endsWith("/")),
  ];
  for (const move of ordered) {
    const from = move.from.replace(/\/$/, "");
    const to = move.to.replace(/\/$/, "");
    await attempt(`move ${move.from} → ${move.to}`, async () => {
      await mkdir(join(root, parentOf(to) === "" ? "." : parentOf(to)), { recursive: true });
      await rename(join(root, from), join(root, to));
    });
  }

  // Translations last, written beside their sources; the sources go only
  // after verification (fitApply), so a failed step leaves everything intact.
  const done: TranslateStep[] = [];
  for (const step of plan.steps) {
    if (step.kind !== "translate") continue;
    await attempt(`translate ${step.from} → ${step.to}`, async () => {
      if (!translator)
        throw new Error("translation needs the AI layer; `dolly ai connect` turns it on");
      const contents = await translator(step, plan, done);
      await mkdir(join(root, parentOf(step.to) === "" ? "." : parentOf(step.to)), {
        recursive: true,
      });
      await writeFile(join(root, step.to), contents);
      done.push(step);
    });
  }
  return { applied, failures };
}

/**
 * The pattern's own judgment of a translation: its typecheck and test
 * commands, run in the project. Absent commands verify nothing, and the
 * report says so.
 */
async function verifyTranslations(
  root: string,
  pattern: Pattern,
): Promise<{ ok: boolean; notes: string[] }> {
  const verbs = ["typecheck", "test"] as const;
  const notes: string[] = [];
  let ok = true;
  for (const verb of verbs) {
    const command = pattern.commands?.[verb];
    if (!command) {
      notes.push(
        `no ${verb} command in the pattern, so the translation is unverified on that front`,
      );
      continue;
    }
    const child = Bun.spawn(["sh", "-c", command], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (code === 0) notes.push(`${verb} passed: ${command}`);
    else {
      ok = false;
      notes.push(`${verb} failed (${command}, exit ${code}):\n${(stderr || stdout).trim()}`);
    }
  }
  return { ok, notes };
}

export interface FitApplyResult {
  plan: FitPlan;
  checkpoint: string;
  applied: string[];
  failures: string[];
  /** What the pattern's own commands said about the translations, when there were any. */
  verified: string[];
  /** True only when every step landed AND git recorded the commit. */
  committed: boolean;
}

export interface FitApplyOptions extends FitOptions {
  translator?: Translator;
}

/**
 * The write path, whole: refuses anything but a clean git tree, records a
 * checkpoint branch at HEAD, applies the plan, and commits the result on
 * the current branch. Revertible means `git switch` back, not trusting
 * memory.
 */
export async function fitApply(
  store: PatternStore,
  patternName: string,
  projectDir: string,
  options: FitApplyOptions = {},
): Promise<FitApplyResult> {
  const root = resolve(projectDir);
  const state = await gitStateOf(root);
  if (state === "missing") {
    throw new FitGitError("fit --apply needs a git repository; the checkpoint branch is the undo.");
  }
  if (state === "dirty") {
    throw new FitGitError("the working tree is dirty; commit or stash before fit --apply.");
  }
  const plan = await fitProject(store, patternName, root, options);
  const checkpoint = await createCheckpoint(root, patternName);
  const { applied, failures } = await applyFitPlan(root, plan, options.translator);
  // Translations are judged by the pattern's own commands before a single
  // source is removed (ADR-0004); a failed verification commits nothing.
  const translated = plan.steps.filter((s): s is TranslateStep => s.kind === "translate");
  const verified: string[] = [];
  if (translated.length > 0 && failures.length === 0) {
    const { pattern } = await store.load(patternName);
    const verdict = await verifyTranslations(root, pattern);
    verified.push(...verdict.notes);
    if (verdict.ok) {
      for (const step of translated) await rm(join(root, step.from), { force: true });
      applied.push(
        `removed ${translated.length} translated source${translated.length === 1 ? "" : "s"}`,
      );
    } else failures.push("verification failed, so the sources stay and nothing is committed");
  }
  // A half-applied tree is never committed. It stays in the working tree
  // for inspection, with the checkpoint branch still marking the pre-fit
  // state. And git's own exit codes are the truth about whether a commit
  // happened; claiming "committed" over a failed one would be worse than
  // any failure it papered over.
  let committed = false;
  if (applied.length > 0 && failures.length === 0) {
    const add = await runGit(root, "add", "-A");
    const commit = add.ok
      ? await runGit(root, "commit", "-m", `dolly fit ${patternName}`, "--no-verify")
      : add;
    if (commit.ok) committed = true;
    else {
      failures.push(
        `git commit failed, so the applied changes sit uncommitted in the working tree: ${commit.out.trim()}`,
      );
    }
  } else if (applied.length > 0) {
    failures.push(
      "not committed because some steps failed; inspect the working tree (the checkpoint branch still marks the pre-fit state)",
    );
  }
  return { plan, checkpoint, applied, failures, verified, committed };
}

async function createCheckpoint(root: string, patternName: string): Promise<string> {
  const prefix = `dolly/fit-${slugify(patternName, "pattern")}`;
  const { out } = await runGit(
    root,
    "branch",
    "--list",
    `${prefix}-*`,
    "--format=%(refname:short)",
  );
  const taken = new Set(out.split("\n").filter(Boolean));
  let n = 1;
  while (taken.has(`${prefix}-${n}`)) n++;
  const name = `${prefix}-${n}`;
  const { ok, out: error } = await runGit(root, "branch", name);
  if (!ok) throw new FitGitError(`could not create the checkpoint branch: ${error.trim()}`);
  return name;
}

export async function gitStateOf(root: string): Promise<"missing" | "clean" | "dirty"> {
  const inside = await runGit(root, "rev-parse", "--is-inside-work-tree");
  if (!inside.ok) return "missing";
  const status = await runGit(root, "status", "--porcelain");
  return status.out.trim() === "" ? "clean" : "dirty";
}

/**
 * True when the destination exists and is not the source itself. The one
 * rename allowed to "overwrite" is a case-only rename on a case-insensitive
 * filesystem, where both names stat the same inode. Anything else at the
 * destination (a gitignored file the inventory cannot see, a file where a
 * directory should go) is a collision.
 */
async function collides(root: string, from: string, to: string): Promise<boolean> {
  let destination: Awaited<ReturnType<typeof stat>>;
  try {
    destination = await stat(join(root, to));
  } catch {
    return false;
  }
  try {
    const source = await stat(join(root, from));
    return !(source.dev === destination.dev && source.ino === destination.ino);
  } catch {
    return true;
  }
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function joinRel(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
}

/** ".py", ".vue"… for decline messages; "extensionless" when there is none. */
function extensionLabel(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "extensionless";
}

function depth(path: string): number {
  return path.replace(/\/$/, "").split("/").length;
}
