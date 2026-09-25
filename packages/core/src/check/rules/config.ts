import { join } from "node:path";
import { isManifestName } from "../../extract/registry";
import { isSafePatternPath } from "../../pattern/schema";
import { getDeep, isSafeDottedPath } from "../../serialize";
import { pathWithin, readIfExists } from "../../tree/files";
import type { FixPlan } from "../fix";
import { invisibleFile, type Rule, type Violation } from "../rule";
import { canRewrite, isSubsetOf, parseLoose } from "../support";

export const configRule: Rule = {
  id: "config",
  async check({ root, pattern, patternDir, inventory, diagnose }) {
    const toolchain = pattern.toolchain;
    if (!toolchain) return [];
    const violations: Violation[] = [];
    const visible = new Set(inventory.files.map((f) => f.path));

    for (const [sourceId, patternRel] of Object.entries(toolchain.configs)) {
      const target = (sourceId.split("#")[0] as string).trim();
      // Defects of the pattern, not the project, but never silent: a teammate
      // who imported this pattern as a bundle has only check to tell them.
      if (!isSafePatternPath(target) || target.endsWith("/")) {
        diagnose(`config source "${sourceId}" is not a safe relative path; not checked.`);
        continue;
      }
      const captured = await pathWithin(patternDir, patternRel).then(readIfExists, () => undefined);
      if (captured === undefined) {
        diagnose(
          `captured config ${patternRel} is missing from the pattern or sits behind a symlink, so ${sourceId} was not checked.`,
        );
        continue;
      }
      const hash = sourceId.indexOf("#");
      const dotted = hash === -1 ? undefined : sourceId.slice(hash + 1);
      if (dotted !== undefined && !isSafeDottedPath(dotted)) {
        diagnose(`config source "${sourceId}" is not a safe key path; not checked.`);
        continue;
      }
      const mode = toolchain.binding[sourceId] ?? "subset";
      const structured = /\.(jsonc?|toml)$/i.test(target);

      // A gitignored or generated config is invisible to the pattern's eyes,
      // like any other file: reported, never read or rewritten (the inventory
      // decides visibility; only the disk decides absence).
      const projectFile = Bun.file(join(root, target));
      const exists = visible.has(target);
      if (!exists && (await projectFile.exists())) {
        violations.push(invisibleFile("config", target));
        continue;
      }
      const mergePlan = (capturedValue: unknown): FixPlan => ({
        kind: "merge",
        path: target,
        value: capturedValue,
        ...(dotted === undefined ? {} : { at: dotted }),
      });

      if (!exists) {
        // The layout rule refuses to invent a root manifest, and so does this
        // one: a file holding only `[tool.ruff]` is not a pyproject.toml.
        if (isManifestName(target)) {
          violations.push({
            rule: "config",
            path: target,
            message: `missing: the pattern captures ${sourceId}, but a manifest is a project decision, so create it yourself (or rescaffold with dolly new)`,
          });
          continue;
        }
        const capturedValue = dotted === undefined ? undefined : parseLoose(target, captured);
        if (dotted !== undefined && capturedValue === undefined) {
          diagnose(`captured config for ${sourceId} could not be parsed; not checked.`);
          continue;
        }
        violations.push({
          rule: "config",
          path: target,
          message: `missing: the pattern captures ${sourceId}`,
          fix:
            dotted === undefined
              ? { kind: "create", path: target, contents: captured }
              : mergePlan(capturedValue),
        });
        continue;
      }
      if (mode === "presence") continue; // it exists; its contents are the project's
      const projectText = await projectFile.text();

      if (mode === "verbatim" || (!structured && dotted === undefined)) {
        if (projectText === captured) continue;
        // Only explicit verbatim gets the overwrite fix: subset falling back to
        // byte equality must not clobber a hand-edited file (ground rule 4).
        violations.push({
          rule: "config",
          path: target,
          message:
            mode === "verbatim"
              ? "differs from the captured config (verbatim binding); `dolly fit` rewrites it behind a checkpoint"
              : "differs from the captured config (not JSON/TOML, so subset falls back to byte equality); reconcile by hand, or bind it as verbatim or presence in toolchain.binding",
          ...(mode === "verbatim"
            ? { fix: { kind: "write", path: target, contents: captured } satisfies FixPlan }
            : {}),
        });
        continue;
      }

      const capturedValue = parseLoose(target, captured);
      if (capturedValue === undefined) {
        diagnose(`captured config for ${sourceId} could not be parsed; not checked.`);
        continue;
      }
      const projectValue = parseLoose(target, projectText);
      if (projectValue === undefined) {
        violations.push({
          rule: "config",
          path: target,
          message: `could not be parsed, so the captured ${sourceId} keys cannot be verified`,
        });
        continue;
      }
      const projectSub = dotted === undefined ? projectValue : getDeep(projectValue, dotted);
      if (isSubsetOf(capturedValue, projectSub)) continue;

      const rewritable = canRewrite(target, projectText);
      violations.push({
        rule: "config",
        path: target,
        message: `captured ${sourceId} keys are missing or differ (subset binding)${rewritable ? "" : "; the file has comments or a shape dolly's serializer would reflow, so merge by hand"}`,
        ...(rewritable ? { fix: mergePlan(capturedValue) } : {}),
      });
    }
    return violations;
  },
};
