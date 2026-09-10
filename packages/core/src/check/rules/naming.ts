import { extensionsOfLanguages } from "../../extract/languages";
import {
  dirsHoldingCode,
  extensionOf,
  isMandated,
  isMandatedDir,
  normalizeStem,
  stylesMatching,
} from "../../extract/naming";
import type { Rule, Violation } from "../rule";

export const namingRule: Rule = {
  id: "naming",
  check({ pattern, inventory }) {
    const naming = pattern.naming;
    if (!naming) return [];
    const violations: Violation[] = [];
    // Naming is a convention about code: with a languages facet, only its
    // extensions are judged; an explicit naming.extensions entry is the
    // author's opt-in for anything else (extract scopes its vote the same
    // way, so check never flags what the vote never saw).
    const allowed = pattern.languages?.programming?.length
      ? extensionsOfLanguages(pattern.languages.programming)
      : undefined;
    const codeDirs = allowed === undefined ? undefined : dirsHoldingCode(inventory, allowed);

    for (const { path } of inventory.files) {
      const base = path.slice(path.lastIndexOf("/") + 1);
      if (isMandated(path, base)) continue;
      const extension = extensionOf(base);
      const optedIn = extension !== undefined && naming.extensions[extension] !== undefined;
      if (
        allowed !== undefined &&
        !optedIn &&
        (extension === undefined || !allowed.has(extension))
      ) {
        continue;
      }
      const dot = base.indexOf(".");
      const stem = normalizeStem(base.slice(0, dot === -1 ? undefined : dot));
      if (stem === "") continue;
      const expected = (extension ? naming.extensions[extension] : undefined) ?? naming.files;
      if (!expected || stylesMatching(stem).includes(expected)) continue;
      violations.push({
        rule: "naming",
        path,
        message: `"${stem}" is not ${expected}; renames break imports, so check only reports it and \`dolly fit\` plans the rename`,
      });
    }

    if (naming.directories) {
      for (const dir of inventory.dirs) {
        if (dir === ".github" || dir.startsWith(".github/")) continue;
        if (codeDirs !== undefined && !codeDirs.has(dir)) continue;
        const base = dir.slice(dir.lastIndexOf("/") + 1);
        if (isMandatedDir(base)) continue;
        const stem = normalizeStem(base);
        if (stem === "" || stylesMatching(stem).includes(naming.directories)) continue;
        violations.push({
          rule: "naming",
          path: `${dir}/`,
          message: `"${base}" is not ${naming.directories}; renames break imports, so check only reports it and \`dolly fit\` plans the rename`,
        });
      }
    }
    return violations;
  },
};
