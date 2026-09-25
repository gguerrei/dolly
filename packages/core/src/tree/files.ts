import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";

/**
 * The small file helpers every scanner needs: a read that treats absence
 * as undefined, parsers that treat a broken file the same way, a path
 * check, and a walk. dolly reads and writes trees other people wrote, and
 * a committed symlink is the one thing that turns a read or a write inside
 * a tree into one outside it, so none of these ever follows one.
 */

/** The file's text, or undefined when it is absent or anything but a regular file (a symlink included). */
export async function readIfExists(absPath: string): Promise<string | undefined> {
  const info = await lstat(absPath).catch(() => undefined);
  return info?.isFile() ? Bun.file(absPath).text() : undefined;
}

export async function readJsonSafe(absPath: string): Promise<Record<string, unknown> | undefined> {
  const text = await readIfExists(absPath);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function parseTomlSafe(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try {
    return parseToml(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * `join(root, rel)`, refused when `rel` climbs out or any segment of it
 * under `root` is a symlink. Segments that do not exist yet are fine: the
 * write that follows creates them. The one gate every read and write of a
 * project or a pattern directory passes.
 */
export async function pathWithin(root: string, rel: string): Promise<string> {
  let at = root;
  for (const segment of rel.split("/").filter((s) => s !== "" && s !== ".")) {
    if (segment === "..") throw new Error(`${rel} leaves the directory, which dolly never allows.`);
    at = join(at, segment);
    const info = await lstat(at).catch(() => undefined);
    if (info?.isSymbolicLink()) {
      throw new Error(`${rel} is a symlink or sits under one, which dolly never follows.`);
    }
  }
  return at;
}

/** Every regular file under dir, dir-relative with forward slashes, sorted; a symlink, file or directory, is never entered. */
export async function walkFiles(dir: string, rel = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(dir, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await walkFiles(dir, path)));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}
