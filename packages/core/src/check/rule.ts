import type { Pattern } from "../pattern/schema";
import type { Inventory } from "../tree/inventory";
import type { FixPlan } from "./fix";

/**
 * The one contract every rule implements. A rule reads the shared context
 * and reports violations (each carrying at most one `FixPlan`, data the
 * executor in fix.ts interprets) and files pattern defects through
 * `diagnose`, never silently (a broken pattern must not report as a
 * conforming project).
 */

export type RuleId =
  | "layout"
  | "naming"
  | "config"
  | "commands"
  | "license"
  | "testing"
  | "hooks"
  | "env"
  | "languages"
  | "releases";

export interface Violation {
  rule: RuleId;
  /** Project-relative path the violation is about. */
  path: string;
  message: string;
  /** The autofix, as data; absent when only a human can resolve it. */
  fix?: FixPlan;
}

export interface RuleContext {
  /** Absolute project root. */
  root: string;
  pattern: Pattern;
  patternName: string;
  /** Absolute directory of the pattern (captured configs live here). */
  patternDir: string;
  inventory: Inventory;
  /** Files a defect of the pattern (or of the run), not of the project. */
  diagnose(message: string): void;
}

export interface Rule {
  id: RuleId;
  check(ctx: RuleContext): Promise<Violation[]> | Violation[];
}

/** The report-only violation for a file the pattern's eyes cannot see. */
export function invisibleFile(rule: RuleId, path: string): Violation {
  return {
    rule,
    path,
    message:
      "exists on disk but is invisible to the pattern's eyes (gitignored or generated), so unignore it, or adjust the pattern",
  };
}
