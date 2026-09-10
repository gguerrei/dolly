import type { CheckReport, ConventionsReport } from "@dollysheep/core";

/**
 * The wire shape of a check report, shared by `dolly check --json` and the
 * daemon so a script and the GUI read the same thing. The FixPlan collapses
 * to `fixable`: consumers act on plans, they never parse them.
 */
export interface CheckView {
  pattern: string;
  violations: {
    rule: string;
    path: string;
    message: string;
    fixable: boolean;
    /** Present when the marker's `rules` turned the rule down. */
    severity?: "warning";
  }[];
  fixed: string[];
  diagnostics: string[];
  /** Violations the project's `.dolly` ignore list and rule settings set aside. */
  ignored: number;
  /** The model's reading of the prose conventions, under `--conventions`. */
  conventions?: ConventionsReport;
}

export function checkView(pattern: string, report: CheckReport): CheckView {
  return {
    pattern,
    violations: report.violations.map((v) => ({
      rule: v.rule,
      path: v.path,
      message: v.message,
      fixable: v.fix !== undefined,
      ...(v.severity ? { severity: v.severity } : {}),
    })),
    fixed: report.fixed,
    diagnostics: report.diagnostics,
    ignored: report.ignored,
    ...(report.conventions ? { conventions: report.conventions } : {}),
  };
}
