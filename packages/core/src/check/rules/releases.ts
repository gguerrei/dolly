import { renderChangelog } from "../../apply/changelog";
import {
  CHANGELOG_NAMES,
  detectReleaseTool,
  findChangelog,
  RELEASE_TOOLS,
} from "../../extract/releases";
import { invisibleFile, type Rule, type Violation } from "../rule";
import { existsOnDisk } from "../support";

/**
 * The tree-shaped half of the releases facet (ADR-0005): a hand-kept
 * changelog must exist, and the release tool's fingerprint must be at the
 * root. Versioning lives in tags and is nobody's path to check.
 */
export const releasesRule: Rule = {
  id: "releases",
  async check({ root, pattern, inventory }) {
    const releases = pattern.releases;
    if (!releases) return [];
    const violations: Violation[] = [];

    if (releases.changelog === "keep-a-changelog" && !findChangelog(inventory)) {
      const onDisk = (
        await Promise.all(
          CHANGELOG_NAMES.map(async (name) =>
            (await existsOnDisk(root, name)) ? name : undefined,
          ),
        )
      ).find((name) => name !== undefined);
      violations.push(
        onDisk
          ? invisibleFile("releases", onDisk)
          : {
              rule: "releases",
              path: "CHANGELOG.md",
              message: "missing: the pattern keeps a changelog by hand, in Keep a Changelog form",
              fix: { kind: "create", path: "CHANGELOG.md", contents: renderChangelog(releases) },
            },
      );
    }

    const tool = RELEASE_TOOLS.find((t) => t.id === releases.tool);
    // A tool dolly does not know cannot be fingerprinted, so it is the author's to check.
    if (tool && (await detectReleaseTool(inventory))?.id !== tool.id) {
      const expected = tool.fingerprints[0] ?? `[tool.${tool.pyprojectTable}] in pyproject.toml`;
      violations.push({
        rule: "releases",
        path: tool.fingerprints[0] ?? "pyproject.toml",
        message: `missing: the pattern releases with ${tool.id}, which is configured by ${expected}; tool configs are never written automatically`,
      });
    }
    return violations;
  },
};
