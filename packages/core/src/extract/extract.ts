import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { PatternDocument } from "../pattern/document";
import { type Pattern, slugify } from "../pattern/schema";
import type { PatternStore } from "../store";
import { collectInventory, rootFiles } from "../tree/inventory";
import { agreePatterns } from "./agreement";
import { scanCommands } from "./commands";
import { scanCommits } from "./commits";
import { scanDependencies } from "./dependencies";
import { projectIdentity } from "./identity";
import { scanLanguages } from "./languages";
import { scanLayout } from "./layout";
import { scanLicense } from "./license";
import { scanNaming } from "./naming";
import { ecosystemOf } from "./registry";
import { scanReleases } from "./releases";
import { scanScaffold } from "./scaffold";
import { scanTesting } from "./testing";
import { scanToolchain } from "./toolchain";

/**
 * The extract orchestrator: one shared inventory feeds the scanners, facets
 * merge into the pattern frontmatter, and every scanner's notes render under
 * one "## Extraction notes" section; scanners never write prose themselves.
 */
export interface ExtractResult {
  document: PatternDocument;
  /** Captured config files, pattern-relative (e.g. "toolchain/biome.json"). */
  files: Record<string, string>;
}

/** One repository's extraction with its notes still by section, before the prose is rendered. */
export interface RepoExtract {
  /** The repository's own name: its directory's basename. */
  name: string;
  result: ExtractResult;
  sections: [string, string[]][];
}

export async function extractPattern(repoPath: string, name?: string): Promise<ExtractResult> {
  return (await extractRepo(repoPath, name)).result;
}

/**
 * Several repositories, one pattern: each is extracted on its own, then
 * the facets they agree on become the pattern (extract/agreement.ts) and
 * everything left out is named in the notes, with each repository's own
 * notes after them. The order given breaks ties.
 */
export async function extractFromRepos(repoPaths: string[], name: string): Promise<ExtractResult> {
  const repos: RepoExtract[] = [];
  for (const path of repoPaths) repos.push(await extractRepo(path));
  const agreement = agreePatterns(repos, name);
  const prose = renderProse([
    ["Agreement", agreement.notes],
    ...repos.map((repo): [string, string[]] => [
      `Notes from ${repo.name}`,
      repo.sections.flatMap(([title, notes]) => notes.map((note) => `${title}: ${note}`)),
    ]),
  ]);
  return { document: { pattern: agreement.pattern, prose }, files: agreement.files };
}

async function extractRepo(repoPath: string, name?: string): Promise<RepoExtract> {
  const root = resolve(repoPath);
  const target = await stat(root).catch(() => null);
  if (!target) throw new Error(`${repoPath} does not exist.`);
  if (!target.isDirectory()) throw new Error(`${repoPath} is not a directory.`);
  const inventory = await collectInventory(root);

  const languages = await scanLanguages(inventory);
  // One primary ecosystem per repo, shared by toolchain and dependencies so
  // their facets can never disagree, and shared with `new` (see registry).
  const primary = ecosystemOf(languages.languages?.programming ?? [], rootFiles(inventory));
  const toolchain = await scanToolchain(inventory, primary);
  const dependencies = await scanDependencies(inventory, toolchain.toolchain, primary);
  const claimedConfigs = new Set(
    Object.keys(toolchain.toolchain?.configs ?? {}).map(
      (sourceId) => sourceId.split("#")[0] as string,
    ),
  );
  // What no pattern may carry away: the project's own name, in a path or a template.
  const identity = await projectIdentity(inventory);
  const layout = await scanLayout(inventory, claimedConfigs, identity.name);
  const naming = scanNaming(inventory, languages.languages);
  const commands = await scanCommands(inventory, toolchain.toolchain);
  const license = await scanLicense(inventory);
  const scaffold = await scanScaffold(inventory, layout.templateGroups, identity);
  const testing = scanTesting(inventory, languages.languages);
  // The two reads past the tree, under ADR-0005.
  const commits = await scanCommits(root);
  const releases = await scanReleases(inventory);

  const pattern: Pattern = {
    format: 1,
    name: name ?? slugify(basename(root), "extracted-pattern"),
    description: `Extracted from the ${basename(root)} project.`,
    ...(license.license ? { license: license.license } : {}),
    ...(languages.languages ? { languages: languages.languages } : {}),
    ...(naming.naming ? { naming: naming.naming } : {}),
    layout: layout.layout,
    ...(toolchain.toolchain ? { toolchain: toolchain.toolchain } : {}),
    ...(testing.testing ? { testing: testing.testing } : {}),
    ...(commands.commands ? { commands: commands.commands } : {}),
    ...(dependencies.dependencies ? { dependencies: dependencies.dependencies } : {}),
    ...(scaffold.scaffold ? { scaffold: scaffold.scaffold } : {}),
    ...(commits.commits ? { commits: commits.commits } : {}),
    ...(releases.releases ? { releases: releases.releases } : {}),
  };

  const sections: [string, string[]][] = [
    ["Layout", layout.notes],
    ["Naming", naming.notes],
    ["Toolchain", toolchain.notes],
    ["Testing", testing.notes],
    ["Commands", commands.notes],
    ["Dependencies", dependencies.notes],
    ["Languages", languages.notes],
    ["License", license.notes],
    ["Scaffold", scaffold.notes],
    ["Commits", commits.notes],
    ["Releases", releases.notes],
  ];

  return {
    name: basename(root),
    result: {
      document: { pattern, prose: renderProse(sections) },
      files: { ...toolchain.files, ...scaffold.files },
    },
    sections,
  };
}

/** Saves the extracted pattern plus its captured config files. */
export async function saveExtractedPattern(
  store: PatternStore,
  result: ExtractResult,
): Promise<void> {
  // A re-extract replaces the pattern wholesale: captured files the new
  // extraction no longer produces must not linger, or exported bundles
  // would carry retired configs and templates forever.
  if (await store.has(result.document.pattern.name)) {
    await store.delete(result.document.pattern.name);
  }
  await store.save(result.document);
  const dir = store.dirOf(result.document.pattern.name);
  for (const [relPath, contents] of Object.entries(result.files)) {
    await mkdir(join(dir, dirname(relPath)), { recursive: true });
    await writeFile(join(dir, relPath), contents);
  }
}

function renderProse(sections: [string, string[]][]): string {
  const rendered = sections
    .filter(([, notes]) => notes.length > 0)
    .map(([title, notes]) => `### ${title}\n\n${notes.map((note) => `- ${note}`).join("\n")}`);
  const intro =
    "Describe your conventions here. This prose travels with the pattern and is read by humans and the optional AI layer; the facets above are enforced deterministically.";
  if (rendered.length === 0) return intro;
  return `${intro}\n\n## Extraction notes\n\n${rendered.join("\n\n")}`;
}
