import { basename, join } from "node:path";
import { renderLicense } from "../../apply/licenses";
import { findLicenseFile, fingerprintFile, spdxIds } from "../../extract/license";
import { slugify } from "../../pattern/schema";
import { isPlainObject } from "../../serialize";
import { rootFiles } from "../../tree/inventory";
import { invisibleFile, type Rule, type Violation } from "../rule";
import { canRewrite, existsOnDisk, parseLoose } from "../support";

export const licenseRule: Rule = {
  id: "license",
  async check({ root, pattern, inventory }) {
    const license = pattern.license;
    if (!license) return [];
    const atRoot = rootFiles(inventory);
    const projectName = slugify(basename(root), "project");
    const violations: Violation[] = [];

    if (atRoot.has("package.json")) {
      const text = await Bun.file(join(root, "package.json")).text();
      try {
        const manifest = JSON.parse(text) as Record<string, unknown>;
        // The legacy object form `license: { type: "MIT" }` still declares.
        const declared =
          typeof manifest.license === "string"
            ? manifest.license
            : isPlainObject(manifest.license) && typeof manifest.license.type === "string"
              ? manifest.license.type
              : undefined;
        if (declared !== license) {
          const rewritable = canRewrite("package.json", text);
          violations.push({
            rule: "license",
            path: "package.json",
            message: `${
              declared === undefined
                ? `has no license field (the pattern says ${license})`
                : `declares "${declared}", but the pattern says ${license}`
            }${rewritable ? "" : "; the manifest's shape is not one dolly will rewrite, so edit it by hand"}`,
            ...(rewritable
              ? { fix: { kind: "merge" as const, path: "package.json", value: { license } } }
              : {}),
          });
        }
      } catch {
        // An unparseable manifest is already the commands rule's violation.
      }
    }

    // TOML manifests declare licenses too; a rewrite would drop comments and
    // reflow shapes, so the fix is offered only when reserialization is a
    // byte-for-byte no-op (same rule as configs).
    const tomlManifests: { file: string; table: string }[] = [
      { file: "pyproject.toml", table: "project" },
      { file: "Cargo.toml", table: "package" },
    ];
    for (const { file, table } of tomlManifests) {
      if (!atRoot.has(file)) continue;
      const text = await Bun.file(join(root, file)).text();
      const parsed = parseLoose(file, text);
      if (!isPlainObject(parsed)) continue;
      const section = parsed[table];
      if (!isPlainObject(section)) continue;
      // `license = { file = "LICENSE" }` defers to the file, which the LICENSE
      // fingerprint below already checks, so there is nothing to compare here.
      if (isPlainObject(section.license) && typeof section.license.file === "string") continue;
      // pyproject also allows the table form `license = { text = "MIT" }`.
      const declared =
        typeof section.license === "string"
          ? section.license
          : isPlainObject(section.license)
            ? (section.license as { text?: string }).text
            : undefined;
      if (declared === license) continue;
      const rewritable = canRewrite(file, text);
      violations.push({
        rule: "license",
        path: file,
        message: `${
          declared === undefined
            ? `has no license field (the pattern says ${license})`
            : `declares "${declared}", but the pattern says ${license}`
        }${rewritable ? "" : "; the file has comments or a shape dolly will not rewrite, so set it by hand"}`,
        ...(rewritable
          ? { fix: { kind: "merge" as const, path: file, value: { license }, at: table } }
          : {}),
      });
    }

    const licensePath = findLicenseFile(inventory);
    if (!licensePath) {
      const candidates = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"];
      const onDisk = (
        await Promise.all(
          candidates.map(async (name) => ((await existsOnDisk(root, name)) ? name : undefined)),
        )
      ).find((name) => name !== undefined);
      if (onDisk) {
        violations.push(invisibleFile("license", onDisk));
        return violations;
      }
      violations.push({
        rule: "license",
        path: "LICENSE",
        message: `missing: the pattern licenses projects as ${license}`,
        fix: {
          kind: "create",
          path: "LICENSE",
          contents:
            renderLicense(license, `the ${projectName} authors`) ??
            `This project is licensed under ${license}.\n\nReplace this file with the full license text: https://spdx.org/licenses/\n`,
        },
      });
    } else {
      const fingerprint = await fingerprintFile(inventory, licensePath);
      const textIds = fingerprint.id ? [fingerprint.id] : (fingerprint.candidates ?? []);
      if (textIds.length > 0 && !textIds.some((id) => spdxIds(license).includes(id))) {
        violations.push({
          rule: "license",
          path: licensePath,
          message: `reads like ${textIds.join(" or ")}, but the pattern says ${license}; license text is never replaced automatically`,
        });
      }
    }
    return violations;
  },
};
