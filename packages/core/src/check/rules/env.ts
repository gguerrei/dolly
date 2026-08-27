import type { Rule, Violation } from "../rule";

/**
 * The inventory already applies .gitignore, so "the walk can see this .env"
 * IS the violation, with no second ignore-matching implementation to drift.
 */
export const envRule: Rule = {
  id: "env",
  check({ inventory }) {
    const violations: Violation[] = [];
    for (const { path } of inventory.files) {
      const base = path.slice(path.lastIndexOf("/") + 1);
      if (!/^\.env(\..+)?$/.test(base)) continue;
      if (/\.(example|sample|template|dist)$/.test(base)) continue; // meant to be committed
      violations.push({
        rule: "env",
        path,
        message:
          "environment file is not gitignored, leaving secrets one `git add -A` away from history",
        fix: { kind: "append", path: ".gitignore", text: `${base}\n`, skipIfLine: base },
      });
    }
    return violations;
  },
};
