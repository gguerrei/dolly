import { parse as parseToml } from "smol-toml";

/**
 * The small file-reading helpers every scanner needs: a read that treats
 * absence as undefined, and parsers that treat a broken file the same way.
 * One home, so the modules cannot drift on what "missing" means.
 */

export async function readIfExists(absPath: string): Promise<string | undefined> {
  const file = Bun.file(absPath);
  return (await file.exists()) ? file.text() : undefined;
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
