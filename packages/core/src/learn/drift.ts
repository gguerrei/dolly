/**
 * Drift: where a project has moved away from its pattern, as proposals the
 * pattern could adopt (docs/design/ai.md, learning mode). The project is
 * re-extracted with the same scanners `extract` uses and compared facet by
 * facet. Proposals only ever add or replace: a pattern losing something is
 * check's conversation, not learn's.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { nameRegex } from "../check/rules/layout";
import { extractPattern } from "../extract/extract";
import type { LayoutEntry, Pattern } from "../pattern/schema";
import { isPlainObject } from "../serialize";
import type { PatternStore } from "../store";

export interface Proposal {
  /** Facet path as segments, since keys carry dots (["toolchain", "configs", "biome.json"]); ["layout"] appends an entry, ["prose"] a convention line. */
  path: string[];
  /** The value the project now reads as; a layout entry or a prose line for those paths. */
  value: unknown;
  /** What the pattern holds today; absent when the pattern never had it. */
  before?: unknown;
  reason: string;
  /** Captured config bytes a toolchain proposal writes into the pattern directory on accept. */
  files?: Record<string, string>;
}

/** Facets compared leaf by leaf; everything else is handled on its own terms or left alone. */
const LEAF_FACETS = [
  "license",
  "languages",
  "naming",
  "toolchain",
  "testing",
  "commands",
  "dependencies",
] as const;

/** Bookkeeping under toolchain that is not a tool choice. */
const TOOLCHAIN_SKIP = new Set(["toolchain.configs", "toolchain.binding"]);

/** A path for people: segments joined, the way the frontmatter nests. */
export function pathLabel(path: string[]): string {
  return path.join(".");
}

export async function learnDrift(
  store: PatternStore,
  patternName: string,
  projectDir: string,
): Promise<Proposal[]> {
  const current = (await store.load(patternName)).pattern;
  const fresh = await extractPattern(projectDir, patternName);
  const proposals: Proposal[] = [];
  for (const facet of LEAF_FACETS) {
    proposals.push(...leafDrift(fresh.document.pattern[facet], current[facet], [facet]));
  }
  proposals.push(...layoutDrift(fresh.document.pattern.layout, current.layout));
  proposals.push(...(await configDrift(fresh, current, store.dirOf(patternName))));
  return proposals;
}

/** Scalars and lists of scalars, compared at every leaf the extract produced. */
function leafDrift(fresh: unknown, current: unknown, path: string[]): Proposal[] {
  if (fresh === undefined || TOOLCHAIN_SKIP.has(path.join("."))) return [];
  if (isPlainObject(fresh)) {
    return Object.entries(fresh).flatMap(([key, child]) =>
      leafDrift(child, isPlainObject(current) ? current[key] : undefined, [...path, key]),
    );
  }
  const label = pathLabel(path);
  if (Array.isArray(fresh)) {
    // Lists only grow: a language the project dropped is not learn's to take away.
    const held = Array.isArray(current) ? current : [];
    const added = fresh.filter((item) => !held.some((have) => sameValue(have, item)));
    if (added.length === 0) return [];
    return [
      {
        path,
        value: [...held, ...added],
        ...(Array.isArray(current) ? { before: current } : {}),
        reason: `the project also has ${added.join(", ")} under ${label}`,
      },
    ];
  }
  if (sameValue(fresh, current)) return [];
  return [
    {
      path,
      value: fresh,
      ...(current === undefined ? {} : { before: current }),
      reason:
        current === undefined
          ? `the project has ${label} as ${String(fresh)}, which the pattern never set`
          : `the project now reads as ${String(fresh)}, where the pattern says ${String(current)}`,
    },
  ];
}

/** Entries the project carries that the pattern has no line for, in the extractor's order. */
function layoutDrift(fresh: LayoutEntry[], current: LayoutEntry[]): Proposal[] {
  const known = new Set(current.map((entry) => entry.path));
  // An instance of a {name} entry (packages/lamb/ under packages/{name}/) is not drift.
  const bare = (path: string) => path.replace(/\/$/, "");
  const templated = current
    .filter((entry) => entry.path.includes("{name}"))
    .map((entry) => nameRegex(bare(entry.path)));
  return fresh
    .filter((entry) => !known.has(entry.path) && !templated.some((re) => re.test(bare(entry.path))))
    .map((entry) => ({
      path: ["layout"],
      value: entry,
      reason: `the project has ${entry.path}, which the pattern's layout does not list`,
    }));
}

/** Captured configs the pattern lacks, or holds with different bytes. */
async function configDrift(
  fresh: Awaited<ReturnType<typeof extractPattern>>,
  current: Pattern,
  patternDir: string,
): Promise<Proposal[]> {
  const proposals: Proposal[] = [];
  const configs = fresh.document.pattern.toolchain?.configs ?? {};
  for (const [sourceId, relPath] of Object.entries(configs)) {
    const bytes = fresh.files[relPath];
    if (bytes === undefined) continue;
    const held = current.toolchain?.configs?.[sourceId];
    const stored = typeof held === "string" ? await readOrNull(join(patternDir, held)) : null;
    if (stored === bytes) continue;
    proposals.push({
      path: ["toolchain", "configs", sourceId],
      value: relPath,
      ...(typeof held === "string" ? { before: held } : {}),
      reason:
        stored === null
          ? `the project's ${sourceId} is not captured by the pattern`
          : `the project's ${sourceId} no longer matches the captured copy`,
      files: { [relPath]: bytes },
    });
  }
  return proposals;
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
