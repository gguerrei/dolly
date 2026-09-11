import type { Dirent } from "node:fs";
import { lstat, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type PatternDocument,
  PatternParseError,
  parsePatternDocument,
  serializePatternDocument,
} from "./pattern/document";
import { isSafePatternPath, patternSchema } from "./pattern/schema";

export const PATTERN_FILE = "pattern.md";

/** Root of everything dolly stores on this machine. Override with DOLLY_HOME. */
export function dollyHome(): string {
  const override = process.env.DOLLY_HOME;
  if (override) return override;
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", "dolly");
    case "win32":
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "dolly");
    default:
      return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "dolly");
  }
}

export class PatternNotFoundError extends Error {
  override name = "PatternNotFoundError";

  constructor(name: string) {
    super(`No saved pattern named "${name}". Run \`dolly list\` to see what exists.`);
  }
}

export class InvalidPatternNameError extends Error {
  override name = "InvalidPatternNameError";

  constructor(name: string) {
    super(`"${name}" is not a valid pattern name (lowercase kebab-case, e.g. "fastapi-service").`);
  }
}

export interface PatternSummary {
  name: string;
  description: string;
  /** Set when pattern.md exists but can't be parsed: the pattern needs fixing, not hiding. */
  error?: string;
}

/** Saved patterns live one per directory: `<root>/<name>/pattern.md` beside its toolchain/ and templates/ captures. */
export class PatternStore {
  constructor(readonly root: string = join(dollyHome(), "patterns")) {}

  async list(): Promise<PatternSummary[]> {
    let entries: Dirent[];
    try {
      entries = await readdir(this.root, { withFileTypes: true });
    } catch {
      return []; // No store directory yet simply means no patterns.
    }

    const summaries: PatternSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const { pattern } = await this.load(entry.name);
        // Patterns are keyed by directory name; the frontmatter name may drift after hand edits.
        summaries.push({ name: entry.name, description: pattern.description });
      } catch (error) {
        if (error instanceof PatternParseError) {
          summaries.push({ name: entry.name, description: "", error: error.message });
        }
        // Anything else (no pattern.md, junk directory name) is simply not a pattern.
      }
    }
    return summaries.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Whether a pattern.md exists for this name, valid or not. */
  async has(name: string): Promise<boolean> {
    const path = this.pathOf(name); // Invalid names throw rather than reporting "absent".
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  /** Absolute path of a pattern's directory, whether or not it exists yet. */
  dirOf(name: string): string {
    assertPatternName(name);
    return join(this.root, name);
  }

  /** Absolute path of a pattern's pattern.md, whether or not it exists yet. */
  pathOf(name: string): string {
    return join(this.dirOf(name), PATTERN_FILE);
  }

  async load(name: string): Promise<PatternDocument> {
    const path = this.pathOf(name); // Invalid names throw their own error, not "not found".
    let source: string;
    try {
      source = await readFile(path, "utf8");
    } catch {
      throw new PatternNotFoundError(name);
    }
    return parsePatternDocument(source);
  }

  async save(doc: PatternDocument): Promise<void> {
    const dir = this.dirOf(doc.pattern.name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, PATTERN_FILE), serializePatternDocument(doc));
  }

  async delete(name: string): Promise<void> {
    // Require a pattern.md but not a parseable one, so broken patterns can still be deleted.
    if (!(await this.has(name))) throw new PatternNotFoundError(name);
    await rm(this.dirOf(name), { recursive: true });
  }

  /** The pattern's captured files (configs and templates), pattern-relative and sorted; pattern.md is not among them. */
  async files(name: string): Promise<string[]> {
    if (!(await this.has(name))) throw new PatternNotFoundError(name);
    const dir = this.dirOf(name);
    const files: string[] = [];
    for (const entry of await readdir(dir, { recursive: true })) {
      const rel = entry.replaceAll("\\", "/");
      if (rel !== PATTERN_FILE && (await lstat(join(dir, rel))).isFile()) files.push(rel);
    }
    return files.sort();
  }

  /** Absolute path of a captured file, behind the one gate every pattern path passes. */
  fileOf(name: string, rel: string): string {
    if (!isSafePatternPath(rel) || !/^(toolchain|templates)\/.+/.test(rel)) {
      throw new InvalidPatternFileError(rel);
    }
    return join(this.dirOf(name), rel);
  }
}

export class InvalidPatternFileError extends Error {
  override name = "InvalidPatternFileError";

  constructor(rel: string) {
    super(
      `"${rel}" is not a captured file: those live under toolchain/ or templates/ in the pattern.`,
    );
  }
}

/** Names come from user input and become paths, so validate before any join. */
function assertPatternName(name: string): void {
  if (!patternSchema.shape.name.safeParse(name).success) {
    throw new InvalidPatternNameError(name);
  }
}
