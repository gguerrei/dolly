import { watch } from "node:fs";
import { resolve } from "node:path";
import { matchesGlob } from "../extract/globs";
import { type RuleSetting, readMarker } from "../marker";
import type { Pattern } from "../pattern/schema";
import type { PatternStore } from "../store";
import { collectInventory, comparePaths, DENY_DIRS } from "../tree/inventory";
import { applyFix, losingCreates } from "./fix";
import type { Rule, RuleId, Violation } from "./rule";
import { commandsRule } from "./rules/commands";
import { configRule } from "./rules/config";
import { envRule } from "./rules/env";
import { hooksRule } from "./rules/hooks";
import { languagesRule } from "./rules/languages";
import { layoutRule } from "./rules/layout";
import { licenseRule } from "./rules/license";
import { namingRule } from "./rules/naming";
import { releasesRule } from "./rules/releases";
import { testingRule } from "./rules/testing";

/**
 * `dolly check`: verifies a project against its pattern, rule by rule. A
 * plain check never writes; `fix` applies exactly the plans reported
 * (create, append, merge, never delete or move), then re-runs the rules so
 * the report reflects the tree as it now stands (and so fixing twice is a
 * no-op, the milestone's acceptance bar).
 *
 * Each rule implements the one contract in rule.ts, and every fix is data
 * (fix.ts) applied by the one executor, which is what lets a report
 * travel as JSON and what fit's dry-run diff will build on.
 *
 * Two invariants every rule must keep (docs/design/check.md):
 * - The inventory decides *visibility*; only the disk decides *absence*. A
 *   file the inventory cannot see (gitignored, generated) may still exist,
 *   and no fix may ever truncate it.
 * - Pattern defects (missing captures, unsafe ids) are diagnostics, never
 *   silence: a broken pattern must not report as a conforming project.
 */

/** Reporting order is the array's order. */
const RULES: Rule[] = [
  layoutRule,
  namingRule,
  configRule,
  commandsRule,
  licenseRule,
  testingRule,
  hooksRule,
  envRule,
  languagesRule,
  releasesRule,
];

export interface CheckReport {
  /** Violations present (after fixing, when fix ran). */
  violations: Violation[];
  /** "path: message" lines for what fix resolved, in application order. */
  fixed: string[];
  /** Defects of the pattern (or failed fixes), not of the project. */
  diagnostics: string[];
  /** Violations the project's `.dolly` ignore list and rule settings set aside. */
  ignored: number;
  /** The model's reading of the prose conventions, only under `--conventions` with AI on; never counted. */
  conventions?: ConventionsReport;
}

export interface ConventionFinding {
  path: string;
  line?: number;
  message: string;
}

export interface ConventionsReport {
  model: string;
  findings: ConventionFinding[];
  /** Files the bounds left out, each with the reason. */
  skipped: string[];
}

export async function checkProject(
  store: PatternStore,
  patternName: string,
  projectDir: string,
  options: { fix?: boolean } = {},
): Promise<CheckReport> {
  const { pattern } = await store.load(patternName);
  const root = resolve(projectDir);
  const patternDir = store.dirOf(patternName);
  const marker = await markerSettings(root);

  const first = await runRules(root, pattern, patternName, patternDir, marker);
  if (!options.fix) {
    return { ...first, fixed: [], diagnostics: [...marker.diagnostics, ...first.diagnostics] };
  }

  const fixed: string[] = [];
  const fixFailures: string[] = [];
  const skip = losingCreates(first.violations);
  for (const violation of first.violations) {
    // A whole-file overwrite (the verbatim binding) is fit's to apply, behind its checkpoint.
    if (!violation.fix || violation.fix.kind === "write" || skip.has(violation)) continue;
    try {
      // A skipped fix (the disk guard held) is not a performed one; the
      // re-run below decides whether its violation still stands.
      if ((await applyFix(root, violation.fix)) === "applied") {
        fixed.push(`${violation.path}: ${violation.message}`);
      }
    } catch (error) {
      // EACCES, disk full, and the like: the re-run below re-reports the violation.
      fixFailures.push(
        `${violation.path}: fix failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  // Re-run so the report reflects the fixed tree: a fix that did not stick
  // resurfaces here instead of being reported as resolved.
  const second = await runRules(root, pattern, patternName, patternDir, marker);
  return {
    ...second,
    fixed,
    diagnostics: [...marker.diagnostics, ...second.diagnostics, ...fixFailures],
  };
}

/** The project's own word from the marker: paths to ignore and rules turned off or down. */
interface MarkerSettings {
  ignore: string[];
  rules: Partial<Record<RuleId, RuleSetting>>;
  diagnostics: string[];
}

/** A marker that does not parse applies nothing and says so. */
async function markerSettings(root: string): Promise<MarkerSettings> {
  try {
    const marker = await readMarker(root);
    return { ignore: marker?.ignore ?? [], rules: marker?.rules ?? {}, diagnostics: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ignore: [], rules: {}, diagnostics: [message] };
  }
}

/** True when the path, or a directory above it, matches an ignore entry. */
export function isIgnored(path: string, ignore: string[]): boolean {
  const bare = path.replace(/\/$/, "");
  const candidates = [bare];
  for (let slash = bare.lastIndexOf("/"); slash !== -1; slash = bare.lastIndexOf("/", slash - 1)) {
    candidates.push(bare.slice(0, slash));
  }
  return ignore.some((entry) => {
    const glob = entry.replace(/\/$/, "");
    return candidates.some((candidate) => matchesGlob(glob, candidate));
  });
}

/**
 * Watches a project and re-checks on a debounce, the whole of `--watch`,
 * in the engine so CLI and GUI share it. Returns a disposer. Fixing is
 * deliberately not an option here: a watcher that edits the tree it
 * watches is a feedback loop.
 */
export function watchProject(
  store: PatternStore,
  patternName: string,
  projectDir: string,
  onReport: (report: CheckReport) => void,
  onError: (error: unknown) => void,
): () => void {
  const root = resolve(projectDir);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => checkProject(store, patternName, root).then(onReport, onError);
  void run();
  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    const top = (filename?.toString() ?? "").split(/[\\/]/)[0] ?? "";
    if (top === ".git" || DENY_DIRS.has(top)) return;
    clearTimeout(timer);
    timer = setTimeout(run, 300);
  });
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}

async function runRules(
  root: string,
  pattern: Pattern,
  patternName: string,
  patternDir: string,
  { ignore, rules }: MarkerSettings,
): Promise<{ violations: Violation[]; diagnostics: string[]; ignored: number }> {
  const inventory = await collectInventory(root);
  const diagnostics: string[] = [];
  const context = {
    root,
    pattern,
    patternName,
    patternDir,
    inventory,
    diagnose: (message: string) => diagnostics.push(message),
  };
  const found: Violation[] = [];
  for (const rule of RULES) found.push(...(await rule.check(context)));
  // The project's own word: an ignored violation, or one from a rule turned
  // off, is neither reported nor fixed; a rule turned down still reports.
  const violations: Violation[] = [];
  for (const violation of found) {
    const setting = rules[violation.rule];
    if (setting === "off" || isIgnored(violation.path, ignore)) continue;
    violations.push(setting === "warn" ? { ...violation, severity: "warning" } : violation);
  }
  const order = (id: RuleId) => RULES.findIndex((rule) => rule.id === id);
  violations.sort((a, b) => order(a.rule) - order(b.rule) || comparePaths(a.path, b.path));
  return { violations, diagnostics, ignored: found.length - violations.length };
}
