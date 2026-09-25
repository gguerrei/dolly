import { join } from "node:path";
import type { Releases } from "../pattern/schema";
import { parseTomlSafe, readIfExists } from "../tree/files";
import { runGit } from "../tree/git";
import { type Inventory, rootFiles } from "../tree/inventory";

/**
 * The releases facet: the tag shape from history (the second and last
 * read past the tree), the changelog's style and the release tool from the
 * tree. Each field is absent rather than guessed.
 */
export const RELEASES_TUNING = {
  /** Fewer tags than this and no versioning is voted. */
  minTags: 3,
  /** A tag shape becomes a facet iff ≥ 80% of the tags read as it. */
  winRatio: [8, 10] as const,
};

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
/** A year-led tag: 2026.8, 2026-08-22, 2026.08.1. */
const CALVER = /^(?:19|20)\d{2}[.-]\d{1,2}(?:[.-]\d{1,2})?(?:[.-]\d+)?$/;

/** Changelog file names, in the order the first match wins. */
export const CHANGELOG_NAMES = ["CHANGELOG.md", "CHANGELOG", "CHANGES.md", "HISTORY.md"];

export interface ReleaseTool {
  id: string;
  /** The root files and directories that fingerprint it; the first is the one to add. */
  fingerprints: string[];
  /** A `[tool.<table>]` in pyproject.toml that fingerprints it too. */
  pyprojectTable?: string;
  writesChangelog: boolean;
}

/** Release tools by their root fingerprints, the same way toolchain's matrix works. */
export const RELEASE_TOOLS: ReleaseTool[] = [
  { id: "changesets", fingerprints: [".changeset/"], writesChangelog: true },
  {
    id: "semantic-release",
    fingerprints: [
      ".releaserc",
      ".releaserc.json",
      ".releaserc.yaml",
      ".releaserc.yml",
      ".releaserc.js",
      ".releaserc.cjs",
      "release.config.js",
      "release.config.cjs",
      "release.config.mjs",
    ],
    writesChangelog: true,
  },
  { id: "release-please", fingerprints: ["release-please-config.json"], writesChangelog: true },
  { id: "git-cliff", fingerprints: ["cliff.toml"], writesChangelog: true },
  {
    id: "standard-version",
    fingerprints: [".versionrc", ".versionrc.json", ".versionrc.js", ".versionrc.cjs"],
    writesChangelog: true,
  },
  {
    id: "commitizen",
    fingerprints: [".cz.toml", ".cz.json", ".cz.yaml"],
    pyprojectTable: "commitizen",
    writesChangelog: true,
  },
  {
    id: "python-semantic-release",
    fingerprints: [],
    pyprojectTable: "semantic_release",
    writesChangelog: true,
  },
  {
    id: "goreleaser",
    fingerprints: [".goreleaser.yml", ".goreleaser.yaml"],
    writesChangelog: false,
  },
];

export interface ReleasesScan {
  releases?: Releases;
  notes: string[];
}

/** The release tool the root fingerprints name, if any. */
export async function detectReleaseTool(inventory: Inventory): Promise<ReleaseTool | undefined> {
  const atRoot = rootFiles(inventory);
  const present = (fingerprint: string) =>
    fingerprint.endsWith("/")
      ? inventory.dirs.includes(fingerprint.slice(0, -1))
      : atRoot.has(fingerprint);
  const byFile = RELEASE_TOOLS.find((tool) => tool.fingerprints.some(present));
  if (byFile) return byFile;
  if (!atRoot.has("pyproject.toml")) return undefined;
  const pyproject = parseTomlSafe(await readIfExists(join(inventory.root, "pyproject.toml")));
  const tables = (pyproject?.tool ?? {}) as Record<string, unknown>;
  return RELEASE_TOOLS.find((tool) => tool.pyprojectTable && tool.pyprojectTable in tables);
}

/** The changelog file at the root, when the inventory can see one. */
export function findChangelog(inventory: Inventory): string | undefined {
  const atRoot = rootFiles(inventory);
  return CHANGELOG_NAMES.find((name) => atRoot.has(name));
}

/** True when the text follows Keep a Changelog: it says so, or uses the format's headings. */
export function isKeepAChangelog(text: string): boolean {
  return (
    /keepachangelog\.com/i.test(text) ||
    /^## \[?unreleased\]?/im.test(text) ||
    /^### (Added|Changed|Deprecated|Removed|Fixed|Security)\s*$/m.test(text)
  );
}

export async function scanReleases(inventory: Inventory): Promise<ReleasesScan> {
  const notes: string[] = [];
  const facet: Releases = {};

  const versioning = await voteVersioning(inventory.root);
  if (versioning) facet.versioning = versioning;

  const tool = await detectReleaseTool(inventory);
  if (tool) facet.tool = tool.id;

  const changelog = findChangelog(inventory);
  const text = changelog
    ? ((await readIfExists(join(inventory.root, changelog))) ?? "").slice(0, 4096)
    : undefined;
  if (text !== undefined && isKeepAChangelog(text)) facet.changelog = "keep-a-changelog";
  else if (tool?.writesChangelog) facet.changelog = "generated";
  else if (changelog) {
    notes.push(
      `${changelog} exists but its style is not one dolly recognizes; set \`releases.changelog\` by hand.`,
    );
  }

  return Object.keys(facet).length > 0 ? { releases: facet, notes } : { notes };
}

/** The tag shape, over every tag, with monorepo and `v` prefixes stripped. */
async function voteVersioning(root: string): Promise<Releases["versioning"]> {
  const tags = await runGit(root, "tag", "--list");
  if (!tags.ok) return undefined;
  const versions = tags.out
    .split("\n")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => tag.slice(tag.lastIndexOf("@") + 1).replace(/^(?:v|release-)/i, ""));
  if (versions.length < RELEASES_TUNING.minTags) return undefined;
  const [num, den] = RELEASES_TUNING.winRatio;
  const clears = (count: number) => count * den >= versions.length * num;
  // Year-led tags parse as semver too, so calver is asked first.
  if (clears(versions.filter((v) => CALVER.test(v)).length)) return "calver";
  if (clears(versions.filter((v) => SEMVER.test(v)).length)) return "semver";
  return undefined;
}
