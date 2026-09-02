import { join } from "node:path";
import { detect } from "tinyld";
import type { Languages } from "../pattern/schema";
import { parseTomlSafe, readIfExists, readJsonSafe } from "../tree/files";
import type { Inventory, InventoryFile } from "../tree/inventory";
import languageData from "./languages-data.json";

/**
 * Detects the sanctioned programming languages (linguist data, lookup only),
 * runtime version pins, and the natural language of the docs corpus.
 */
export const LANGUAGES_TUNING = {
  /** A language joins the facet at ≥ 2 files and ≥ 1% byte share, or ≥ 5 files. */
  minFiles: 2,
  minSharePercent: 1,
  soloFiles: 5,
  /** Natural language needs this much cleaned prose, at this chunk agreement. */
  minCorpusChars: 512,
  minChunkChars: 200,
  chunkChars: 512,
  minAgreement: [8, 10] as const,
  perFileChars: 4096,
  maxCorpusChars: 32768,
};

/** linguist types these as markup, but they are the repo's code. */
const COMPONENT_FORMATS = new Set(["Vue", "Svelte", "Astro"]);

/** Fixed fallback when sibling bytes can't disambiguate an extension. */
const AMBIGUOUS_DEFAULTS: Record<string, string> = {
  ".h": "C",
  ".m": "Objective-C",
  ".pl": "Perl",
  ".v": "Verilog",
  ".md": "Markdown",
  ".rs": "Rust",
  ".ts": "TypeScript",
  ".sql": "SQL",
  ".php": "PHP",
  ".cs": "C#",
  ".fs": "F#",
  ".r": "R",
};

/** Binary assets are neither code nor "unrecognized code"; they are invisible. */
const ASSET_EXTENSIONS = new Set([
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  ".eot",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".bmp",
  ".mp3",
  ".mp4",
  ".wav",
  ".ogg",
  ".webm",
  ".mov",
  ".avi",
  ".flac",
  ".m4a",
  ".zip",
  ".gz",
  ".tar",
  ".7z",
  ".pdf",
  ".so",
  ".dll",
  ".dylib",
  ".exe",
  ".bin",
  ".wasm",
  ".sqlite",
  ".db",
  ".parquet",
  ".pkl",
  ".npy",
  ".pt",
  ".onnx",
]);

interface LanguageEntry {
  name: string;
  type: string;
  extensions?: string[];
  filenames?: string[];
  interpreters?: string[];
}

const entries = languageData as LanguageEntry[];
const byFilename = new Map<string, LanguageEntry>();
const byExtension = new Map<string, LanguageEntry[]>();
const byInterpreter = new Map<string, LanguageEntry>();
for (const entry of entries) {
  for (const filename of entry.filenames ?? []) byFilename.set(filename, entry);
  for (const extension of entry.extensions ?? []) {
    const list = byExtension.get(extension.toLowerCase()) ?? [];
    list.push(entry);
    byExtension.set(extension.toLowerCase(), list);
  }
  for (const interpreter of entry.interpreters ?? []) byInterpreter.set(interpreter, entry);
}

/**
 * The file extensions belonging to the named languages, which is how the naming
 * facet scopes itself to code. An asset or a doc is not a naming
 * convention; it only participates when the author writes an explicit
 * `naming.extensions` entry for it.
 */
export function extensionsOfLanguages(names: string[]): Set<string> {
  const wanted = new Set(names);
  const extensions = new Set<string>();
  for (const entry of entries) {
    if (!wanted.has(entry.name)) continue;
    for (const extension of entry.extensions ?? []) extensions.add(extension.toLowerCase());
  }
  return extensions;
}

/**
 * The code files the vote reads, each resolved to one language: an
 * ambiguous extension goes to its default unless a programming-type
 * sibling with more unambiguous bytes claims it (a repo of .cpp files
 * rightly claims .h for C++). Data, docs, and assets are absent. Check reads
 * the tree through this same function, so a file is code, and is in a given
 * language, the same way for extract and for the rule.
 */
export interface CodeFile {
  path: string;
  size: number;
  language: string;
}

export async function classifyCode(
  inventory: Inventory,
): Promise<{ files: CodeFile[]; unclassifiedBytes: number }> {
  const resolved: {
    path: string;
    size: number;
    entry: LanguageEntry;
    ambiguous?: { extension: string; candidates: LanguageEntry[] };
  }[] = [];
  let unclassifiedBytes = 0;

  for (const file of inventory.files) {
    const basename = file.path.slice(file.path.lastIndexOf("/") + 1);
    const exact = byFilename.get(basename);
    if (exact) {
      resolved.push({ path: file.path, size: file.size, entry: exact });
      continue;
    }
    const match = candidatesByExtension(basename);
    if (match) {
      const [first] = match.candidates as [LanguageEntry, ...LanguageEntry[]];
      resolved.push({
        path: file.path,
        size: file.size,
        entry: first,
        ...(match.candidates.length > 1 ? { ambiguous: match } : {}),
      });
      continue;
    }
    if (!basename.includes(".")) {
      const viaShebang = await classifyByShebang(join(inventory.root, file.path));
      if (viaShebang) {
        resolved.push({ path: file.path, size: file.size, entry: viaShebang });
        continue;
      }
    }
    const lastDot = basename.lastIndexOf(".");
    if (lastDot <= 0 || !ASSET_EXTENSIONS.has(basename.slice(lastDot).toLowerCase())) {
      unclassifiedBytes += file.size;
    }
  }

  // Ambiguous extensions resolve default-first (.md is Markdown, .ts is
  // TypeScript); only a programming-type sibling with more unambiguous bytes
  // can override.
  const unambiguousBytes = new Map<string, number>();
  for (const r of resolved) {
    if (!r.ambiguous)
      unambiguousBytes.set(r.entry.name, (unambiguousBytes.get(r.entry.name) ?? 0) + r.size);
  }
  const bytesOf = (entry: LanguageEntry | undefined) =>
    entry ? (unambiguousBytes.get(entry.name) ?? 0) : 0;
  for (const r of resolved) {
    if (!r.ambiguous) continue;
    const fallback = r.ambiguous.candidates.find(
      (c) => c.name === AMBIGUOUS_DEFAULTS[r.ambiguous?.extension ?? ""],
    );
    const challenger = r.ambiguous.candidates
      .filter((c) => isCode(c) && c !== fallback)
      .sort((a, b) => bytesOf(b) - bytesOf(a) || (a.name < b.name ? -1 : 1))[0];
    if (challenger && bytesOf(challenger) > bytesOf(fallback)) r.entry = challenger;
    else if (fallback) r.entry = fallback;
    else r.entry = challenger ?? (r.ambiguous.candidates[0] as LanguageEntry);
  }

  return {
    files: resolved
      .filter((r) => isCode(r.entry))
      .map((r) => ({ path: r.path, size: r.size, language: r.entry.name })),
    unclassifiedBytes,
  };
}

export interface LanguageShare {
  files: number;
  bytes: number;
}

/** Files and bytes per language, and the code bytes they add up to. */
export function languageShares(files: CodeFile[]): {
  shares: Map<string, LanguageShare>;
  codeBytes: number;
} {
  const shares = new Map<string, LanguageShare>();
  let codeBytes = 0;
  for (const { language, size } of files) {
    const share = shares.get(language) ?? { files: 0, bytes: 0 };
    share.files += 1;
    share.bytes += size;
    shares.set(language, share);
    codeBytes += size;
  }
  return { shares, codeBytes };
}

/**
 * The facet bar: at least 2 files and 1% of the code bytes, or 5 files.
 * Below it a language is a trace (a lone Dockerfile, one helper script):
 * extract notes it instead of sanctioning it, and check does not hold it
 * against the pattern either.
 */
export function clearsLanguageBar(share: LanguageShare, codeBytes: number): boolean {
  return (
    (share.files >= LANGUAGES_TUNING.minFiles &&
      share.bytes * 100 >= codeBytes * LANGUAGES_TUNING.minSharePercent) ||
    share.files >= LANGUAGES_TUNING.soloFiles
  );
}

/** The extension a file in this language is written with, as the language table lists it first. */
export function primaryExtensionOf(language: string): string | undefined {
  return entries.find((entry) => entry.name === language)?.extensions?.[0];
}

export interface LanguagesScan {
  languages?: Languages;
  notes: string[];
}

export async function scanLanguages(inventory: Inventory): Promise<LanguagesScan> {
  const notes: string[] = [];
  const programming = await detectProgramming(inventory, notes);
  const versions = await collectVersions(inventory);
  const natural = await detectNatural(inventory, notes);

  const hasFacet =
    programming.length > 0 || Object.keys(versions).length > 0 || natural !== undefined;
  return {
    languages: hasFacet ? { programming, versions, ...(natural ? { natural } : {}) } : undefined,
    notes,
  };
}

function isCode(entry: LanguageEntry): boolean {
  return entry.type === "programming" || COMPONENT_FORMATS.has(entry.name);
}

async function detectProgramming(inventory: Inventory, notes: string[]): Promise<string[]> {
  const { files, unclassifiedBytes } = await classifyCode(inventory);
  const { shares, codeBytes } = languageShares(files);

  const sanctioned = [...shares.entries()]
    .filter(([, share]) => clearsLanguageBar(share, codeBytes))
    .sort(([an, a], [bn, b]) => b.bytes - a.bytes || (an < bn ? -1 : 1))
    .map(([name]) => name);

  if (codeBytes > 0) {
    const ranked = [...shares.entries()]
      .sort(([an, a], [bn, b]) => b.bytes - a.bytes || (an < bn ? -1 : 1))
      .map(([name, s]) => {
        const pct = Math.round((s.bytes / codeBytes) * 100);
        return `${name} ${pct === 0 ? "<1" : pct}%`;
      });
    notes.push(
      `Language mix at extraction: ${ranked.join(", ")} (by bytes; data and prose files excluded).`,
    );
    for (const [name, s] of [...shares.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (!sanctioned.includes(name)) {
        notes.push(
          `Traces of ${name} (${s.files} file${s.files === 1 ? "" : "s"}) fall below the facet threshold; add it to languages.programming if intentional.`,
        );
      }
    }
    const pct = Math.round((unclassifiedBytes / (unclassifiedBytes + codeBytes)) * 100);
    if (pct >= 25)
      notes.push(
        `${pct}% of code-adjacent bytes use unrecognized extensions and were excluded from language shares.`,
      );
  }
  return sanctioned;
}

function candidatesByExtension(
  basename: string,
): { extension: string; candidates: LanguageEntry[] } | undefined {
  const lower = basename.toLowerCase();
  // Longest matching extension first, so .d.ts beats .ts style compounds.
  for (let dot = lower.indexOf("."); dot !== -1; dot = lower.indexOf(".", dot + 1)) {
    const candidates = byExtension.get(lower.slice(dot));
    if (candidates) return { extension: lower.slice(dot), candidates };
  }
  return undefined;
}

async function classifyByShebang(absPath: string): Promise<LanguageEntry | undefined> {
  const head = await readHead(absPath, 256);
  if (!head?.startsWith("#!")) return undefined;
  const line = head.split("\n", 1)[0] ?? "";
  const words = line.slice(2).trim().split(/\s+/);
  let interpreter = (words[0] ?? "").split("/").pop() ?? "";
  if (interpreter === "env") interpreter = (words[1] ?? "").split("/").pop() ?? "";
  // python3.12 → python3 → python, until the interpreter map recognizes it.
  while (interpreter !== "") {
    const entry = byInterpreter.get(interpreter);
    if (entry) return entry;
    const trimmed = interpreter.replace(/[\d.]+$/, "");
    if (trimmed === interpreter) return undefined;
    interpreter = trimmed;
  }
  return undefined;
}

/** Runtime pins from the files that declare them; keys are runtime names. */
async function collectVersions(inventory: Inventory): Promise<Record<string, string>> {
  const versions: Record<string, string> = {};
  const root = inventory.root;

  const nvmrc =
    (await readIfExists(join(root, ".nvmrc"))) ?? (await readIfExists(join(root, ".node-version")));
  if (nvmrc?.trim()) versions.node = nvmrc.trim();

  const packageJson = await readJsonSafe(join(root, "package.json"));
  const engines = packageJson?.engines as Record<string, string> | undefined;
  for (const [runtime, range] of Object.entries(engines ?? {})) versions[runtime] = range;

  const pythonVersion = await readIfExists(join(root, ".python-version"));
  if (pythonVersion?.trim()) versions.python = pythonVersion.trim();
  // Parsed, not regexed: a `requires-python =` line inside a string or an
  // unrelated table must not count as the project's pin.
  const pyproject = parseTomlSafe(await readIfExists(join(root, "pyproject.toml")));
  const requiresPython = (pyproject?.project as Record<string, unknown> | undefined)?.[
    "requires-python"
  ];
  if (typeof requiresPython === "string") versions.python = requiresPython;

  const cargo = parseTomlSafe(await readIfExists(join(root, "Cargo.toml")));
  const rustVersion =
    (cargo?.package as Record<string, unknown> | undefined)?.["rust-version"] ??
    (
      (cargo?.workspace as Record<string, unknown> | undefined)?.package as
        | Record<string, unknown>
        | undefined
    )?.["rust-version"];
  if (typeof rustVersion === "string") versions.rust = rustVersion;

  const rubyVersion = await readIfExists(join(root, ".ruby-version"));
  if (rubyVersion?.trim()) versions.ruby = rubyVersion.trim().replace(/^ruby-/, "");
  const gemfileRuby = (await readIfExists(join(root, "Gemfile")))?.match(
    /^ruby\s+["']([^"']+)["']/m,
  )?.[1];
  if (gemfileRuby) versions.ruby = gemfileRuby;

  const javaVersion = await readIfExists(join(root, ".java-version"));
  if (javaVersion?.trim()) versions.java = javaVersion.trim();
  const pom = await readIfExists(join(root, "pom.xml"));
  const pomJava = pom?.match(
    /<(?:maven\.compiler\.(?:release|source|target)|java\.version)>\s*([^<\s]+)\s*</,
  )?.[1];
  if (pomJava && !pomJava.startsWith("$")) versions.java = pomJava;
  const gradle =
    (await readIfExists(join(root, "build.gradle.kts"))) ??
    (await readIfExists(join(root, "build.gradle")));
  const gradleJava = gradle?.match(
    /(?:jvmToolchain|JavaLanguageVersion\.of)\s*\(\s*(\d+)\s*\)/,
  )?.[1];
  if (gradleJava) versions.java = gradleJava;

  const composer = await readJsonSafe(join(root, "composer.json"));
  const php = (composer?.require as Record<string, string> | undefined)?.php;
  if (typeof php === "string") versions.php = php;

  const globalJson = await readJsonSafe(join(root, "global.json"));
  const sdk = (globalJson?.sdk as Record<string, unknown> | undefined)?.version;
  if (typeof sdk === "string") versions.dotnet = sdk;

  return versions;
}

async function detectNatural(inventory: Inventory, notes: string[]): Promise<string | undefined> {
  const corpus = await buildDocsCorpus(inventory);
  if (corpus.length < LANGUAGES_TUNING.minChunkChars) return undefined;

  const chunks: string[] = [];
  for (let i = 0; i < corpus.length; i += LANGUAGES_TUNING.chunkChars)
    chunks.push(corpus.slice(i, i + LANGUAGES_TUNING.chunkChars));
  const last = chunks[chunks.length - 1];
  if (chunks.length > 1 && last && last.length < LANGUAGES_TUNING.minChunkChars) {
    chunks.splice(chunks.length - 2, 2, chunks[chunks.length - 2] + last);
  }

  const votes = new Map<string, number>();
  for (const chunk of chunks) {
    const tag = detect(chunk);
    if (tag) votes.set(tag, (votes.get(tag) ?? 0) + 1);
  }
  if (votes.size === 0) return undefined;

  const [top, topVotes] = [...votes.entries()].sort(
    ([at, a], [bt, b]) => b - a || (at < bt ? -1 : 1),
  )[0] as [string, number];
  const total = [...votes.values()].reduce((a, b) => a + b, 0);
  const [num, den] = LANGUAGES_TUNING.minAgreement;
  const confident =
    corpus.length >= LANGUAGES_TUNING.minCorpusChars && topVotes * den >= total * num;
  if (confident) return top;

  if (topVotes * den < total * num) {
    notes.push(
      `Docs mix languages (top guess "${top}" won ${topVotes} of ${total} chunks); no single natural language set.`,
    );
  } else {
    notes.push(
      `Docs appear to be "${top}", but only ~${corpus.length} chars of prose exist, too little to set languages.natural confidently.`,
    );
  }
  return undefined;
}

async function buildDocsCorpus(inventory: Inventory): Promise<string> {
  const isDoc = (f: InventoryFile) => {
    const basename = f.path.slice(f.path.lastIndexOf("/") + 1).toLowerCase();
    if (/^(license|changelog|code_of_conduct)/.test(basename)) return false;
    const inDocs = f.path.startsWith("docs/") && /\.(md|rst|txt|adoc)$/.test(basename);
    const atRoot = !f.path.includes("/") && basename.endsWith(".md");
    return inDocs || atRoot;
  };
  const docs = inventory.files.filter(isDoc);
  const readmeFirst = [...docs].sort((a, b) => {
    const ar = a.path.toLowerCase().startsWith("readme") ? 0 : 1;
    const br = b.path.toLowerCase().startsWith("readme") ? 0 : 1;
    return ar - br || (a.path < b.path ? -1 : 1);
  });

  let corpus = "";
  for (const doc of readmeFirst) {
    if (corpus.length >= LANGUAGES_TUNING.maxCorpusChars) break;
    const raw = await readIfExists(join(inventory.root, doc.path));
    if (!raw) continue;
    corpus += ` ${cleanProse(raw).slice(0, LANGUAGES_TUNING.perFileChars)}`;
  }
  return corpus.trim().slice(0, LANGUAGES_TUNING.maxCorpusChars);
}

function cleanProse(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<[^>\n]+>/g, " ")
    .replace(/^#+\s*/gm, "")
    .replace(/[|*_>#-]/g, " ")
    .replace(/\s+/g, " ");
}

async function readHead(absPath: string, bytes: number): Promise<string | undefined> {
  const file = Bun.file(absPath);
  if (!(await file.exists())) return undefined;
  const buffer = await file.slice(0, bytes).arrayBuffer();
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
}
