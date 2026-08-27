import { codeLanguagesOf } from "../../extract/languages";
import type { Rule, Violation } from "../rule";

/**
 * The pattern dictates its languages through `languages.programming`. A code
 * file written in a language outside that list is off-pattern; data, docs,
 * and assets are not code and are never judged. Never fixable here: fit
 * plans the translation, and only with the AI layer on
 * (docs/design/translation.md).
 */
export const languagesRule: Rule = {
  id: "languages",
  check({ pattern, inventory }) {
    const sanctioned = pattern.languages?.programming ?? [];
    if (sanctioned.length === 0) return [];
    const allowed = new Set(sanctioned);
    const violations: Violation[] = [];
    for (const file of inventory.files) {
      const candidates = codeLanguagesOf(file.path);
      // An ambiguous extension counts as on-pattern if any reading of it is.
      if (candidates.length === 0 || candidates.some((name) => allowed.has(name))) continue;
      violations.push({
        rule: "languages",
        path: file.path,
        message: `written in ${candidates.join(" or ")}; the pattern sanctions ${sanctioned.join(", ")}`,
      });
    }
    return violations;
  },
};
