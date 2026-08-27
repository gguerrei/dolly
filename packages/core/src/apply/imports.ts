import { join } from "node:path";

/**
 * The relative-import ledger behind fit's ground rule 4: a move must
 * account for its imports or not happen. Scans `.ts/.tsx/.js/.jsx` files
 * for relative specifiers, resolves each against the project tree, and,
 * given a move mapping, plans the exact specifier rewrites. Anything that
 * resolves to more than one file is ambiguity the caller must treat as a
 * reason to decline the move.
 */

export const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/**
 * Importer types that exist but that the ledger cannot read yet: their
 * script blocks import TS/JS invisibly, so their presence makes any move
 * unaccountable (fit's ground rule 4).
 */
export const BLIND_IMPORTERS = /\.(vue|svelte|astro|mdx)$/;

/** How a specifier found its file, preserved so the rewrite keeps the author's style. */
type ResolutionMode = "exact" | "swap" | "bare" | "index";

export interface ImportEdge {
  /** Importing file, project-relative. */
  file: string;
  /** The specifier as written. */
  spec: string;
  /** The file it resolves to, project-relative. */
  target: string;
  mode: ResolutionMode;
  /** Swap mode only: the extension the author wrote (".js"), which the emit
   * produces and a rewrite must reproduce, never recomputed from the target. */
  writtenExt?: string;
}

export interface AmbiguousImport {
  file: string;
  spec: string;
  candidates: string[];
}

export interface ImportRewrite {
  /** File whose import changes, at its pre-move path. */
  file: string;
  from: string;
  to: string;
  /** The import's pre-move resolved target, which is how a move claims its rewrites. */
  target: string;
}

const SPEC_PATTERNS = [
  /\bfrom\s+["']([^"'\n]+)["']/g,
  /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
  /\bimport\s+["']([^"'\n]+)["']/g,
];

export interface ImportScan {
  edges: ImportEdge[];
  ambiguous: AmbiguousImport[];
}

/** Scans every source file's relative imports against the given file set. */
export async function scanImports(root: string, files: string[]): Promise<ImportScan> {
  const fileSet = new Set(files);
  const edges: ImportEdge[] = [];
  const ambiguous: AmbiguousImport[] = [];

  for (const file of files) {
    if (!SOURCE_FILE.test(file)) continue;
    const text = await Bun.file(join(root, file)).text();
    const seen = new Set<string>();
    for (const pattern of SPEC_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const spec = match[1] as string;
        if (seen.has(spec)) continue;
        seen.add(spec);
        if (!spec.startsWith("./") && !spec.startsWith("../")) continue;
        const resolution = resolveSpec(file, spec, fileSet);
        if (resolution === undefined) continue; // assets, generated paths: not ours to track
        if (Array.isArray(resolution)) ambiguous.push({ file, spec, candidates: resolution });
        else edges.push({ file, spec, ...resolution });
      }
    }
  }
  return { edges, ambiguous };
}

/**
 * One file: an edge. Several: the candidate list (ambiguity). None:
 * undefined, because the spec points outside what dolly tracks.
 */
function resolveSpec(
  file: string,
  spec: string,
  files: Set<string>,
): { target: string; mode: ResolutionMode; writtenExt?: string } | string[] | undefined {
  const base = normalize(`${parentOf(file)}/${spec}`);
  if (base === undefined) return undefined; // escapes the project root
  const found: { target: string; mode: ResolutionMode; writtenExt?: string }[] = [];

  const lastSegment = base.slice(base.lastIndexOf("/") + 1);
  if (/\.[a-z0-9]+$/i.test(lastSegment)) {
    if (files.has(base)) found.push({ target: base, mode: "exact" });
    // nodenext style: "./user.js" names the emitted file, resolves the .ts source.
    for (const [from, to] of [
      [".js", ".ts"],
      [".js", ".tsx"],
      [".jsx", ".tsx"],
      [".mjs", ".mts"],
      [".cjs", ".cts"],
    ] as const) {
      if (base.endsWith(from)) {
        const swapped = base.slice(0, -from.length) + to;
        if (files.has(swapped)) found.push({ target: swapped, mode: "swap", writtenExt: from });
      }
    }
  }
  for (const extension of [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]) {
    if (files.has(base + extension)) found.push({ target: base + extension, mode: "bare" });
    if (files.has(`${base}/index${extension}`)) {
      found.push({ target: `${base}/index${extension}`, mode: "index" });
    }
  }

  if (found.length === 0) return undefined;
  const targets = [...new Set(found.map((f) => f.target))];
  if (targets.length > 1) return targets;
  return found[0];
}

/**
 * The rewrites a move mapping induces: for every edge whose importer or
 * target moves, the specifier that keeps the import resolving, written in
 * the same style the author used.
 */
export function planRewrites(edges: ImportEdge[], moved: Map<string, string>): ImportRewrite[] {
  const rewrites: ImportRewrite[] = [];
  for (const edge of edges) {
    const newFile = moved.get(edge.file) ?? edge.file;
    const newTarget = moved.get(edge.target) ?? edge.target;
    if (newFile === edge.file && newTarget === edge.target) continue;
    const spec = specFor(parentOf(newFile), newTarget, edge.mode, edge.writtenExt);
    if (spec !== edge.spec) {
      rewrites.push({ file: edge.file, from: edge.spec, to: spec, target: edge.target });
    }
  }
  return rewrites;
}

/** Renders a project-relative target as a relative specifier in the given style. */
function specFor(
  fromDir: string,
  target: string,
  mode: ResolutionMode,
  writtenExt: string | undefined,
): string {
  let path = target;
  if (mode === "bare") path = path.replace(SOURCE_FILE, "");
  else if (mode === "index") {
    const stripped = path.replace(/\/index\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, "");
    // The index file may itself have been renamed away, so fall back to bare.
    path = stripped === path ? path.replace(SOURCE_FILE, "") : stripped;
  } else if (mode === "swap" && writtenExt !== undefined) {
    // The author's extension is what the emit produces ("./Button.js" for
    // Button.tsx); reproduce it, never derive one from the target's.
    path = path.replace(SOURCE_FILE, writtenExt);
  }
  return relativeSpec(fromDir, path);
}

/** POSIX-relative with the leading "./" imports require. */
function relativeSpec(fromDir: string, target: string): string {
  const from = fromDir === "" ? [] : fromDir.split("/");
  const to = target.split("/");
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) common++;
  const ups = from.length - common;
  const down = to.slice(common).join("/");
  if (ups === 0) return `./${down}`;
  return `${"../".repeat(ups)}${down}`;
}

/**
 * Applies every rewrite for one file in a single pass over its quoted
 * strings; sequential replacement could double-rewrite when one rewrite's
 * result equals another's source, silently repointing an import.
 */
export function rewriteSpecifiers(text: string, rewrites: ImportRewrite[]): string {
  const byFrom = new Map(rewrites.map((rewrite) => [rewrite.from, rewrite.to]));
  return text.replace(/(["'])([^"'\n]*)\1/g, (whole, quote: string, spec: string) => {
    const to = byFrom.get(spec);
    return to === undefined ? whole : `${quote}${to}${quote}`;
  });
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** Resolves "." and ".." segments; undefined when the path escapes the root. */
function normalize(path: string): string | undefined {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return undefined;
      out.pop();
    } else out.push(segment);
  }
  return out.join("/");
}
