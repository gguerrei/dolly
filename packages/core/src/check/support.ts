import { join } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { BANNED_KEYS, isPlainObject, parseByExtension, serializeByExtension } from "../serialize";

/**
 * The inventory hides gitignored and generated files, but they exist, and a
 * create-fix aimed at one would truncate it. Absence is a disk question.
 */
export function existsOnDisk(root: string, path: string): Promise<boolean> {
  return Bun.file(join(root, path)).exists();
}

/** Tolerant parse for comparing; JSONC comments still get checked. */
export function parseLoose(target: string, text: string): unknown {
  try {
    if (/\.toml$/i.test(target)) return parseByExtension(target, text);
    const errors: unknown[] = [];
    const value: unknown = parseJsonc(text, errors as never, { allowTrailingComma: true });
    return errors.length > 0 ? undefined : value;
  } catch {
    return undefined;
  }
}

/**
 * A one-key fix must not come back as a whole-file diff. For JSON and
 * JSONC that is guaranteed by construction: merges apply as minimal text
 * edits (jsonc-parser) that leave comments, tabs, and formatting standing,
 * so parseability is the only bar. TOML has no equivalent editor yet:
 * a rewrite there reserializes the whole file, so the fix is offered only
 * when nothing would be lost (no comments, byte-identical round-trip).
 */
export function canRewrite(target: string, text: string): boolean {
  const parsed = parseLoose(target, text);
  if (!isPlainObject(parsed)) return false;
  if (!/\.toml$/i.test(target)) return true;
  if (/^\s*#/m.test(text)) return false;
  return serializeByExtension(target, parsed) === text;
}

/** Every captured key present and equal, recursively; project extras are fine. */
export function isSubsetOf(captured: unknown, project: unknown): boolean {
  if (isPlainObject(captured) && isPlainObject(project)) {
    return Object.entries(captured).every(
      ([key, value]) =>
        !BANNED_KEYS.has(key) && Object.hasOwn(project, key) && isSubsetOf(value, project[key]),
    );
  }
  return deepEqual(captured, project);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, i) => deepEqual(value, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]))
    );
  }
  return false;
}
