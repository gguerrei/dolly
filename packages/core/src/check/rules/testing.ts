import { extensionOf } from "../../extract/naming";
import { codeExtensions, filePatternOf, isJudgedTest, placementOf } from "../../extract/testing";
import type { Rule, Violation } from "../rule";
import { demandedByLayout } from "./layout";

export const testingRule: Rule = {
  id: "testing",
  check({ pattern, inventory, diagnose }) {
    const testing = pattern.testing;
    if (!testing) return [];
    const allowed = codeExtensions(pattern.languages);
    // A naming shape is judged against its own extension only: a .cs shape
    // says nothing about how another ecosystem's tests in the tree are named.
    const shapeExtension = testing.filePattern ? extensionOf(testing.filePattern) : undefined;
    const contradicted = new Set<string>();
    const violations: Violation[] = [];
    for (const { path } of inventory.files) {
      if (!isJudgedTest(path, allowed)) continue;
      const misplaced = placementOf(path) !== testing.placement;
      // A file the pattern's own layout demands is where the pattern wants
      // it; a layout that demands it out of placement is the pattern
      // contradicting itself, the author's to settle, said once per entry.
      const demanded = demandedByLayout(pattern, path);
      if (demanded) {
        if (misplaced && !contradicted.has(demanded.path)) {
          contradicted.add(demanded.path);
          diagnose(
            `layout demands "${demanded.path}", which the testing facet's ${testing.placement} placement contradicts; settle the pattern.`,
          );
        }
        continue;
      }
      if (misplaced) {
        violations.push({
          rule: "testing",
          path,
          message:
            testing.placement === "separate"
              ? "tests live under a test directory in this pattern; `dolly fit` plans the move"
              : "tests sit next to the code they cover in this pattern; `dolly fit` plans the move",
        });
      } else if (testing.filePattern && extensionOf(basenameOf(path)) === shapeExtension) {
        const shape = filePatternOf(path);
        if (shape !== undefined && shape !== testing.filePattern) {
          violations.push({
            rule: "testing",
            path,
            message: `named ${shape}-style, but the pattern uses ${testing.filePattern}`,
          });
        }
      }
    }
    return violations;
  },
};

function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
