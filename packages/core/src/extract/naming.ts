import type { CaseStyle, Languages, Naming } from "../pattern/schema";
import type { Inventory } from "../tree/inventory";
import { extensionsOfLanguages } from "./languages";

/**
 * Detects case conventions by majority vote over filename stems. A name votes
 * only when it matches exactly one style (`Button` → PascalCase); names
 * matching several styles abstain (`utils`), names matching none count as
 * dissent (`Foo-Bar`). No word segmentation is ever needed at extract time.
 *
 * Check judges every name, abstainers included, so a style becomes a facet
 * only when it also covers the names that abstained: ten PascalCase
 * components cannot make ninety single-word modules PascalCase.
 */
export const NAMING_TUNING = {
  /** A pool becomes a facet iff winner ≥ 80% of (votes + dissent)… */
  winRatio: [8, 10] as const,
  /** …over at least this many distinctive names, and the winner covers 80% of every name judged. */
  minSample: 5,
  /** Report the all-ambiguous case only when it is actually the story. */
  minAmbiguous: 10,
};

/** Styles in tie-break order (first wins a dead heat, keeping output stable). */
const STYLES: { style: CaseStyle; pattern: RegExp }[] = [
  { style: "snake_case", pattern: /^[a-z0-9]+(_[a-z0-9]+)*$/ },
  { style: "kebab-case", pattern: /^[a-z0-9]+(-[a-z0-9]+)*$/ },
  { style: "camelCase", pattern: /^[a-z][a-zA-Z0-9]*$/ },
  { style: "PascalCase", pattern: /^[A-Z][a-zA-Z0-9]*$/ },
  { style: "SCREAMING_SNAKE_CASE", pattern: /^[A-Z0-9]+(_[A-Z0-9]+)*$/ },
];

/** Ecosystem-mandated basenames carry the ecosystem's convention, not the author's. */
const MANDATED_PREFIXES = [
  "readme",
  "license",
  "changelog",
  "contributing",
  "code_of_conduct",
  "security",
];
const MANDATED_EXACT = new Set([
  "makefile",
  "gnumakefile",
  "justfile",
  "dockerfile",
  "package.json",
  "cargo.toml",
  "pyproject.toml",
  "go.mod",
  "go.work",
  "deno.json",
  "deno.jsonc",
]);
const MANDATED_STEMS = new Set(["index", "main", "__init__"]);

interface Pool {
  /** Names matching exactly one style. */
  votes: Map<CaseStyle, number>;
  /** Names matching several styles, counted toward each style they match. */
  compatible: Map<CaseStyle, number>;
  ambiguous: number;
  other: number;
}

export interface NamingScan {
  naming?: Naming;
  notes: string[];
}

export function scanNaming(inventory: Inventory, languages?: Languages): NamingScan {
  const global = newPool();
  const byExtension = new Map<string, Pool>();
  const directories = newPool();
  // Naming is a convention about code. With a languages facet in hand, only
  // its extensions vote: a PascalCase .png or an off-style doc is not
  // dissent against how the code names itself.
  const allowed = languages?.programming?.length
    ? extensionsOfLanguages(languages.programming)
    : undefined;
  const codeDirs = allowed === undefined ? undefined : dirsHoldingCode(inventory, allowed);

  for (const { path } of inventory.files) {
    const basename = path.slice(path.lastIndexOf("/") + 1);
    if (isMandated(path, basename)) continue;
    const extension = extensionOf(basename);
    if (allowed !== undefined && (extension === undefined || !allowed.has(extension))) continue;
    const stem = normalizeStem(
      basename.slice(0, basename.indexOf(".") === -1 ? undefined : basename.indexOf(".")),
    );
    if (stem === "") continue;
    castVote(global, stem);
    if (extension) castVote(poolFor(byExtension, extension), stem);
  }

  for (const dir of inventory.dirs) {
    if (dir === ".github" || dir.startsWith(".github/")) continue;
    if (codeDirs !== undefined && !codeDirs.has(dir)) continue;
    const basename = dir.slice(dir.lastIndexOf("/") + 1);
    if (basename.startsWith(".")) continue;
    const stem = normalizeStem(basename);
    if (stem !== "") castVote(directories, stem);
  }

  const notes: string[] = [];
  const facet: Naming = { extensions: {} };

  const globalWinner = decide(global);
  if (globalWinner.emit) facet.files = globalWinner.style;
  else report(notes, "Files", global, globalWinner);

  for (const [extension, pool] of [...byExtension].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const winner = decide(pool);
    if (winner.emit && winner.style && winner.style !== facet.files)
      facet.extensions[extension] = winner.style;
    else if (!winner.emit) report(notes, `${extension} files`, pool, winner);
  }

  // An extension too small to vote its own override, whose every name
  // still fails the files convention (three kebab-case shell scripts in a
  // snake_case Go repo), is exactly what check will report; say so, and name
  // the override that settles it.
  if (facet.files) {
    for (const [extension, pool] of [...byExtension].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const decision = decide(pool);
      if (decision.emit || decision.sample >= NAMING_TUNING.minSample || decision.total === 0)
        continue;
      const passing = (pool.votes.get(facet.files) ?? 0) + (pool.compatible.get(facet.files) ?? 0);
      if (passing > 0) continue;
      const style = decision.style ? ` (${decision.style} where distinctive)` : "";
      notes.push(
        `${decision.total} ${extension} file${decision.total === 1 ? "" : "s"}${style} do not follow the ${facet.files} files convention, so check will report them; add a naming.extensions entry for ${extension} if that is intentional.`,
      );
    }
  }

  const dirWinner = decide(directories);
  if (dirWinner.emit) facet.directories = dirWinner.style;
  else report(notes, "Directories", directories, dirWinner);

  const hasFacet = facet.files || facet.directories || Object.keys(facet.extensions).length > 0;
  return { naming: hasFacet ? facet : undefined, notes };
}

function newPool(): Pool {
  return { votes: new Map(), compatible: new Map(), ambiguous: 0, other: 0 };
}

function poolFor(map: Map<string, Pool>, key: string): Pool {
  const existing = map.get(key);
  if (existing) return existing;
  const pool = newPool();
  map.set(key, pool);
  return pool;
}

export function isMandated(path: string, basename: string): boolean {
  if (path === ".github" || path.startsWith(".github/")) return true;
  if (basename.startsWith(".")) return true;
  if (/^[[$+@]/.test(basename) || basename.includes("[")) return true;
  const lower = basename.toLowerCase();
  if (MANDATED_EXACT.has(lower)) return true;
  if (MANDATED_PREFIXES.some((p) => lower.startsWith(p))) return true;
  if (lower.startsWith("tsconfig") && lower.endsWith(".json")) return true;
  const stem = basename.includes(".") ? basename.slice(0, basename.indexOf(".")) : basename;
  return MANDATED_STEMS.has(stem.toLowerCase());
}

/** The directories that hold code (at any depth), the ones naming is about. */
export function dirsHoldingCode(inventory: Inventory, allowed: Set<string>): Set<string> {
  const holding = new Set<string>();
  for (const { path } of inventory.files) {
    const extension = extensionOf(path.slice(path.lastIndexOf("/") + 1));
    if (extension === undefined || !allowed.has(extension)) continue;
    for (
      let slash = path.lastIndexOf("/");
      slash !== -1;
      slash = path.lastIndexOf("/", slash - 1)
    ) {
      holding.add(path.slice(0, slash));
    }
  }
  return holding;
}

/**
 * The part of a stem naming judges: `__init__` → `init`, `foo_test` → `foo`,
 * `test_foo` → `foo`. Test affixes (Go's and pytest's) and underscore
 * padding are idiom, not case, so they must not force snake votes.
 */
export function normalizeStem(stem: string): string {
  return stem
    .replace(/^test_/, "")
    .replace(/^_+|_+$/g, "")
    .replace(/_(test|spec)$/, "");
}

export function extensionOf(basename: string): string | undefined {
  const lastDot = basename.lastIndexOf(".");
  return lastDot > 0 ? basename.slice(lastDot).toLowerCase() : undefined;
}

/** The styles a stem matches; check tests names against a facet with this. */
export function stylesMatching(stem: string): CaseStyle[] {
  return STYLES.filter(({ pattern }) => pattern.test(stem)).map(({ style }) => style);
}

/**
 * Renders a stem in a target style, fit's half of the naming contract:
 * extract never needs word segmentation, but a rename does. Words split on
 * separators and camel humps, acronym runs staying whole (`HTTPServer` →
 * http, server).
 */
export function renderStem(stem: string, style: CaseStyle): string {
  const words = stem
    .split(/[-_\s]+/)
    .flatMap((part) =>
      part
        .replace(/([a-z0-9])([A-Z])/g, "$1\0$2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1\0$2")
        .split("\0"),
    )
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());
  if (words.length === 0) return stem;
  switch (style) {
    case "snake_case":
      return words.join("_");
    case "kebab-case":
      return words.join("-");
    case "SCREAMING_SNAKE_CASE":
      return words.join("_").toUpperCase();
    case "camelCase":
      return words.map((w, i) => (i === 0 ? w : w[0]?.toUpperCase() + w.slice(1))).join("");
    case "PascalCase":
      return words.map((w) => w[0]?.toUpperCase() + w.slice(1)).join("");
  }
}

function castVote(pool: Pool, stem: string): void {
  const matches = stylesMatching(stem);
  if (matches.length === 1) {
    pool.votes.set(matches[0] as CaseStyle, (pool.votes.get(matches[0] as CaseStyle) ?? 0) + 1);
  } else if (matches.length > 1) {
    pool.ambiguous++;
    for (const style of matches) pool.compatible.set(style, (pool.compatible.get(style) ?? 0) + 1);
  } else pool.other++;
}

interface Decision {
  emit: boolean;
  style?: CaseStyle;
  winnerVotes: number;
  /** Distinctive names: votes plus dissent. */
  sample: number;
  /** Every name judged: the sample plus the abstainers. */
  total: number;
  /** Names check would pass under the winner. */
  covered: number;
}

function decide(pool: Pool): Decision {
  let style: CaseStyle | undefined;
  let winnerVotes = 0;
  let voteTotal = 0;
  for (const { style: candidate } of STYLES) {
    const count = pool.votes.get(candidate) ?? 0;
    voteTotal += count;
    if (count > winnerVotes) {
      winnerVotes = count;
      style = candidate;
    }
  }
  const sample = voteTotal + pool.other;
  const total = sample + pool.ambiguous;
  const covered = winnerVotes + (style ? (pool.compatible.get(style) ?? 0) : 0);
  const [num, den] = NAMING_TUNING.winRatio;
  const emit =
    sample >= NAMING_TUNING.minSample &&
    winnerVotes * den >= sample * num &&
    covered * den >= total * num;
  return { emit, style, winnerVotes, sample, total, covered };
}

function report(notes: string[], label: string, pool: Pool, decision: Decision): void {
  const [num, den] = NAMING_TUNING.winRatio;
  if (decision.sample >= NAMING_TUNING.minSample) {
    if (decision.style && decision.winnerVotes * den >= decision.sample * num) {
      // The distinctive names agree, but the abstainers would fail check.
      notes.push(
        `${label} lean ${decision.style} (${decision.winnerVotes} of ${decision.sample} distinctive names), but ${decision.total - decision.covered} of the ${decision.total} names judged are not ${decision.style} (single lowercase words, for instance); no facet emitted, since check would flag every one of them. Pick a style and add it to the naming facet.`,
      );
      return;
    }
    const parts = STYLES.filter(({ style }) => pool.votes.get(style))
      .map(({ style }) => `${pool.votes.get(style)} ${style}`)
      .concat(pool.other ? [`${pool.other} other`] : []);
    notes.push(
      `${label} are mixed: ${parts.join(", ")} across ${decision.sample} distinctive names, with no ≥80% convention; pick one and add it to the naming facet.`,
    );
  } else if (label === "Files" && pool.ambiguous >= NAMING_TUNING.minAmbiguous) {
    notes.push(
      `Filenames are mostly single lowercase words (${pool.ambiguous} of them), so kebab-case and snake_case are indistinguishable in this repo; any consistent choice matches.`,
    );
  }
}
