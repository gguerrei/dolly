import { filePatternOf, isTestFile, placementOf } from "../../extract/testing";
import type { Rule, Violation } from "../rule";

export const testingRule: Rule = {
  id: "testing",
  check({ pattern, inventory }) {
    const testing = pattern.testing;
    if (!testing) return [];
    const violations: Violation[] = [];
    for (const { path } of inventory.files) {
      if (!isTestFile(path)) continue;
      if (placementOf(path) !== testing.placement) {
        violations.push({
          rule: "testing",
          path,
          message:
            testing.placement === "separate"
              ? "tests live under a test directory in this pattern; `dolly fit` plans the move"
              : "tests sit next to the code they cover in this pattern; `dolly fit` plans the move",
        });
      } else if (testing.filePattern) {
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
