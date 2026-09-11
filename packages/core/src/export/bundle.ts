import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { strFromU8, unzipSync, zipSync } from "fflate";
import { type PatternDocument, parsePatternDocument } from "../pattern/document";
import { isSafePatternPath, type Pattern } from "../pattern/schema";
import { PATTERN_FILE, type PatternStore } from "../store";

/** A .dolly bundle is a zip of a pattern directory: pattern.md plus its toolchain/ and templates/ captures. */

// Patterns are a handful of text files; anything bigger is rejected before it is decompressed.
const MAX_ENTRIES = 256;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;

export class InvalidBundleError extends Error {
  override name = "InvalidBundleError";
}

export class PatternExistsError extends Error {
  override name = "PatternExistsError";

  constructor(name: string) {
    super(`A pattern named "${name}" already exists.`);
  }
}

/** Pack a saved pattern into a shareable .dolly file and return its absolute path. */
export async function exportBundle(
  store: PatternStore,
  name: string,
  outPath?: string,
): Promise<string> {
  await store.load(name); // Refuses to export a missing or invalid pattern.

  const dir = store.dirOf(name);
  const entries: Record<string, Uint8Array> = {};
  for (const file of await listFiles(dir)) {
    entries[file] = new Uint8Array(await readFile(join(dir, file)));
  }

  const out = resolve(outPath ?? `${name}.dolly`);
  await writeFile(out, zipSync(entries));
  return out;
}

/**
 * Unpack a .dolly file, from a path or an http(s) URL, into the store and
 * return the pattern it contained. With `sha256`, the bytes must hash to it
 * or nothing is read: a pinned URL cannot be swapped under a project.
 */
export async function importBundle(
  store: PatternStore,
  source: string,
  options: { force?: boolean; sha256?: string } = {},
): Promise<Pattern> {
  const entries = await readBundle(source, options.sha256);
  const files = Object.entries(entries).filter(([path]) => !path.endsWith("/"));
  for (const [path] of files) {
    // The same gate every pattern-supplied path passes. Bundles are the
    // most untrusted input of all, so no second, weaker gate here.
    if (!isSafePatternPath(path)) {
      throw new InvalidBundleError(`The bundle entry "${path}" escapes the pattern directory.`);
    }
  }
  const doc = parseBundledPattern(entries[PATTERN_FILE], source);
  const name = doc.pattern.name;

  // Everything above validated the whole bundle; only now does the store change.
  if (await store.has(name)) {
    if (!options.force) throw new PatternExistsError(name);
    await store.delete(name);
  }
  const dir = store.dirOf(name);
  for (const [path, data] of files) {
    const target = join(dir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }
  return doc.pattern;
}

/** Unzip with sanity caps so a tiny malicious file can't balloon into memory or disk. */
async function readBundle(source: string, sha256?: string): Promise<Record<string, Uint8Array>> {
  let entryCount = 0;
  let declaredBytes = 0;
  try {
    const bytes = /^https?:\/\//.test(source)
      ? await fetchBundle(source)
      : new Uint8Array(await readFile(source));
    if (sha256 && createHash("sha256").update(bytes).digest("hex") !== sha256.toLowerCase()) {
      throw new InvalidBundleError(
        `"${source}" does not match the sha256 it was pinned to, so it was not read.`,
      );
    }
    const entries = unzipSync(bytes, {
      filter: (file) => {
        entryCount += 1;
        declaredBytes += file.originalSize;
        assertReasonableSize(entryCount, declaredBytes);
        return true;
      },
    });
    let actualBytes = 0;
    for (const data of Object.values(entries)) {
      actualBytes += data.length;
      assertReasonableSize(entryCount, actualBytes); // Zip headers can lie about sizes.
    }
    return entries;
  } catch (cause) {
    if (cause instanceof InvalidBundleError) throw cause;
    throw new InvalidBundleError(
      `Could not read "${source}" as a .dolly bundle: ${(cause as Error).message}`,
    );
  }
}

/** A bundle from the web, under the same size cap as one on disk, so a link is as safe as a file. */
async function fetchBundle(url: string): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  } catch (cause) {
    throw new InvalidBundleError(`Could not fetch "${url}": ${(cause as Error).message}`);
  }
  if (!response.ok)
    throw new InvalidBundleError(`Could not fetch "${url}": HTTP ${response.status}`);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body ?? []) {
    total += chunk.length;
    assertReasonableSize(1, total);
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function assertReasonableSize(entryCount: number, totalBytes: number): void {
  if (entryCount > MAX_ENTRIES || totalBytes > MAX_TOTAL_BYTES) {
    throw new InvalidBundleError(
      `The bundle is too big to be a pattern (limit: ${MAX_ENTRIES} files, ${MAX_TOTAL_BYTES / 1024 / 1024} MB).`,
    );
  }
}

function parseBundledPattern(file: Uint8Array | undefined, bundlePath: string): PatternDocument {
  if (!file) throw new InvalidBundleError(`The bundle has no ${PATTERN_FILE} at its root.`);
  try {
    return parsePatternDocument(strFromU8(file));
  } catch (cause) {
    throw new InvalidBundleError(
      `"${bundlePath}" contains an invalid ${PATTERN_FILE}: ${(cause as Error).message}`,
    );
  }
}

/** List every regular file under dir as /-separated relative paths. */
async function listFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const name of await readdir(dir, { recursive: true })) {
    const relative = name.replaceAll("\\", "/");
    // lstat so symlinks are skipped: a shared bundle must never pack bytes from outside the dir.
    if ((await lstat(join(dir, relative))).isFile()) files.push(relative);
  }
  return files;
}
