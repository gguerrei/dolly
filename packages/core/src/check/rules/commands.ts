import { join } from "node:path";
import { ecosystemOfPattern } from "../../extract/registry";
import { isPlainObject } from "../../serialize";
import { scanRecipes, TASKFILE_INDENT, TASKFILE_NAMES, taskfile } from "../../taskfile";
import { rootFiles } from "../../tree/inventory";
import { invisibleFile, type Rule, type Violation } from "../rule";
import { canRewrite, existsOnDisk } from "../support";

export const commandsRule: Rule = {
  id: "commands",
  async check({ root, pattern, inventory }) {
    const commands = pattern.commands;
    if (!commands) return [];
    const runner = pattern.toolchain?.taskRunner;
    const atRoot = rootFiles(inventory);
    const violations: Violation[] = [];

    if (runner === "just" || runner === "make") {
      const names = TASKFILE_NAMES[runner];
      const indent = TASKFILE_INDENT[runner];
      const file = names.find((name) => atRoot.has(name));
      if (!file) {
        const onDisk = (
          await Promise.all(
            names.map(async (name) => ((await existsOnDisk(root, name)) ? name : undefined)),
          )
        ).find((name) => name !== undefined);
        if (onDisk) {
          violations.push(invisibleFile("commands", onDisk));
          return violations;
        }
        const body = taskfile(commands, indent);
        violations.push({
          rule: "commands",
          path: names[0] as string,
          message: `missing: the pattern's commands run through ${runner}`,
          fix: {
            kind: "create",
            path: names[0] as string,
            contents:
              runner === "make" ? `.PHONY: ${Object.keys(commands).join(" ")}\n\n${body}` : body,
          },
        });
        return violations;
      }
      const text = await Bun.file(join(root, file)).text();
      const recipes = scanRecipes(text, runner);
      for (const [verb, command] of Object.entries(commands)) {
        const recipe = recipes.find((r) => r.name === verb);
        if (!recipe) {
          violations.push({
            rule: "commands",
            path: file,
            message: `recipe "${verb}" is missing (the pattern runs \`${command}\`)`,
            fix: { kind: "append", path: file, text: `\n${verb}:\n${indent}${command}\n` },
          });
        } else if (
          recipe.params !== "" ||
          recipe.rest !== "" ||
          recipe.body.length !== 1 ||
          (recipe.body[0] as string).replace(/^[@-]+\s*/, "") !== command
        ) {
          violations.push({
            rule: "commands",
            path: file,
            message: `recipe "${verb}" differs from the pattern's \`${command}\`; recipes may grow bodies dolly must not rewrite, so reconcile by hand`,
          });
        }
      }
      return violations;
    }

    // No taskfile prescribed: commands live in npm scripts, when this is an npm pattern.
    if (ecosystemOfPattern(pattern) !== "npm") return violations;
    if (!atRoot.has("package.json")) {
      violations.push({
        rule: "commands",
        path: "package.json",
        message: "missing, so the pattern's commands have nowhere to live",
      });
      return violations;
    }
    const text = await Bun.file(join(root, "package.json")).text();
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(text) as Record<string, unknown>;
    } catch {
      violations.push({
        rule: "commands",
        path: "package.json",
        message: "could not be parsed, so the pattern's commands cannot be verified",
      });
      return violations;
    }
    const scripts = isPlainObject(manifest.scripts) ? manifest.scripts : {};
    // The fix rewrites the whole manifest, so it needs the canonical 2-space
    // shape npm itself writes; anything else is reported, never reflowed.
    const rewritable = canRewrite("package.json", text);
    for (const [verb, command] of Object.entries(commands)) {
      if (scripts[verb] === command) continue;
      const missing = !Object.hasOwn(scripts, verb);
      violations.push({
        rule: "commands",
        path: "package.json",
        message: `${
          missing
            ? `script "${verb}" is missing (the pattern runs \`${command}\`)`
            : `script "${verb}" differs from the pattern's \`${command}\``
        }${rewritable ? "" : "; the manifest's shape is not one dolly will rewrite, so edit it by hand"}`,
        ...(rewritable
          ? {
              fix: {
                kind: "merge" as const,
                path: "package.json",
                value: { scripts: { [verb]: command } },
              },
            }
          : {}),
      });
    }
    return violations;
  },
};
