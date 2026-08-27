import { rootFiles } from "../../tree/inventory";
import type { Rule } from "../rule";

export const hooksRule: Rule = {
  id: "hooks",
  check({ pattern, inventory }) {
    const hooks = pattern.toolchain?.hooks;
    if (!hooks) return [];
    // When the pattern captured the manager's config, the config rule owns
    // it: presence checked there, and missing gets a real create-fix.
    const captured = Object.keys(pattern.toolchain?.configs ?? {});
    const hookConfigs = [
      "lefthook.yml",
      "lefthook.yaml",
      ".lefthook.yml",
      "lefthook.toml",
      ".pre-commit-config.yaml",
    ];
    if (captured.some((source) => hookConfigs.includes(source))) return [];
    const atRoot = rootFiles(inventory);
    const expectations: Record<string, { path: string; present: boolean }> = {
      husky: { path: ".husky/", present: inventory.dirs.includes(".husky") },
      lefthook: {
        path: "lefthook.yml",
        present: ["lefthook.yml", "lefthook.yaml", ".lefthook.yml", "lefthook.toml"].some((f) =>
          atRoot.has(f),
        ),
      },
      "pre-commit": {
        path: ".pre-commit-config.yaml",
        present: atRoot.has(".pre-commit-config.yaml"),
      },
    };
    const expected = expectations[hooks];
    if (!expected || expected.present) return [];
    return [
      {
        rule: "hooks",
        path: expected.path,
        message: `the pattern manages git hooks with ${hooks}, but its config is missing; installing a hook manager is a dependency decision, so set it up yourself`,
      },
    ];
  },
};
