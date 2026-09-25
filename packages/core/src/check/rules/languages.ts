import { classifyCode, clearsLanguageBar, languageShares } from "../../extract/languages";
import type { Rule, Violation } from "../rule";

/**
 * The pattern dictates its languages through `languages.programming`. A code
 * file written in a language outside that list is off-pattern when the tree
 * carries that language at facet strength, the extractor's own bar: a lone
 * Dockerfile or helper script is a trace, which extract would not have
 * sanctioned either, and is never held against the pattern. Data, docs, and
 * assets are not code and are never judged. Never fixable here: fit plans
 * the translation, and only with the AI layer on.
 */
export const languagesRule: Rule = {
  id: "languages",
  async check({ pattern, inventory }) {
    const sanctioned = pattern.languages?.programming ?? [];
    if (sanctioned.length === 0) return [];
    const allowed = new Set(sanctioned);
    const { files } = await classifyCode(inventory);
    const { shares, codeBytes } = languageShares(files);
    const violations: Violation[] = [];
    for (const file of files) {
      if (allowed.has(file.language)) continue;
      const share = shares.get(file.language);
      if (!share || !clearsLanguageBar(share, codeBytes)) continue;
      violations.push({
        rule: "languages",
        path: file.path,
        message: `written in ${file.language}; the pattern sanctions ${sanctioned.join(", ")}`,
      });
    }
    return violations;
  },
};
