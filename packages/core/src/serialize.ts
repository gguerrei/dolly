import { basename } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

/**
 * How dolly reads and writes structured config values: by file extension,
 * with deep-path access that can never reach the prototype chain. Shared by
 * the scaffolder (writing fresh configs), check (comparing and merging),
 * and the fix executor; one serializer means a value round-trips the same
 * bytes no matter which verb touched it.
 */

export const BANNED_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

/** A dotted embed path is safe when no segment can reach the prototype chain. */
export function isSafeDottedPath(dotted: string): boolean {
  return dotted.split(".").every((s) => s !== "" && !BANNED_KEYS.has(s));
}

/** Dotted-path assignment for embedded configs; callers check safety first. */
export function setDeep(target: Record<string, unknown>, dotted: string, value: unknown): void {
  const segments = dotted.split(".");
  let node = target;
  for (const key of segments.slice(0, -1)) {
    const next = node[key];
    if (typeof next !== "object" || next === null) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[segments[segments.length - 1] as string] = value;
}

export function getDeep(value: unknown, dotted: string): unknown {
  let node: unknown = value;
  for (const key of dotted.split(".")) {
    if (!isPlainObject(node)) return undefined;
    node = Object.hasOwn(node, key) ? node[key] : undefined;
  }
  return node;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseByExtension(path: string, contents: string): unknown {
  return path.endsWith(".toml") ? parseToml(contents) : JSON.parse(contents);
}

export function serializeByExtension(path: string, value: Record<string, unknown>): string {
  if (path.endsWith(".toml")) return `${stringifyToml(value)}\n`;
  // Formatters print package.json fully expanded (JSON.stringify's shape) but
  // collapse fitting arrays in other JSON; match them so scaffolds pass check.
  if (basename(path) === "package.json") return `${JSON.stringify(value, null, 2)}\n`;
  return `${formatJson(value, "", 0)}\n`;
}

/**
 * Formatter-shaped JSON: 2-space indent, objects always expanded, arrays
 * inline when the line fits 80 columns, the output biome and prettier
 * settle on, so a freshly scaffolded config is already formatted.
 */
function formatJson(value: unknown, indent: string, column: number): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const inline = `[${value.map((v) => formatJson(v, "", 0)).join(", ")}]`;
    if (!inline.includes("\n") && column + inline.length < 80) return inline;
    const items = value
      .map((v) => `${indent}  ${formatJson(v, `${indent}  `, indent.length + 2)}`)
      .join(",\n");
    return `[\n${items}\n${indent}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const rows = entries.map(([key, child]) => {
      const prefix = `${indent}  ${JSON.stringify(key)}: `;
      return `${prefix}${formatJson(child, `${indent}  `, prefix.length)}`;
    });
    return `{\n${rows.join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}
