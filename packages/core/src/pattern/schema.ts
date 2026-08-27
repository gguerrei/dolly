import { z } from "zod";

/** Case conventions dolly can detect and enforce. */
export const caseStyleSchema = z.enum([
  "snake_case",
  "kebab-case",
  "camelCase",
  "PascalCase",
  "SCREAMING_SNAKE_CASE",
]);

/**
 * Naming conventions, by kind of artifact.
 * `files` is the default for every extension not listed in `extensions`;
 * `extensions` entries win.
 */
export const namingSchema = z.strictObject({
  files: caseStyleSchema.optional(),
  directories: caseStyleSchema.optional(),
  /** Per-extension overrides, e.g. { ".tsx": "PascalCase" }. */
  extensions: z.record(z.string().regex(/^\.[a-z0-9]+$/), caseStyleSchema).default({}),
});

/**
 * The one gate every path a pattern supplies must pass: layout entries,
 * captured config source ids, and template targets alike. Patterns are
 * untrusted input: they are hand-edited and imported from other people's
 * bundles, so a path is only ever a plain relative POSIX path.
 *
 * `.git` is refused along with `..`: a pattern that could write `.git/config`
 * would own the repository `new` is about to create, and git executes config
 * values like `core.fsmonitor` during ordinary commands.
 */
export function isSafePatternPath(path: string): boolean {
  // ":" covers drive letters and NTFS alternate data streams alike.
  if (path === "" || path.startsWith("/") || path.includes("\\") || path.includes(":"))
    return false;
  for (const char of path) {
    const code = char.codePointAt(0) as number;
    if (code < 0x20 || code === 0x7f) return false; // NUL crashes writeFile; controls are hostile
  }
  const segments = path.endsWith("/") ? path.slice(0, -1).split("/") : path.split("/");
  return segments.every((s) => {
    if (s === "" || s === "." || s === "..") return false;
    // Windows ignores case and strips trailing dots and spaces, so ".GIT."
    // lands in ".git" there, so normalize before the comparison.
    const normalized = s.toLowerCase().replace(/[. ]+$/, "");
    return normalized !== "" && normalized !== ".git";
  });
}

/** Layout paths are repo-relative POSIX paths; directories end with "/". */
const layoutPathSchema = z
  .string()
  .min(1)
  .refine(isSafePatternPath, "layout paths are relative POSIX paths without . , .. or .git");

/**
 * One expected path in the project tree. `{name}` is a placeholder for exactly
 * one path segment: check matches any single segment (case is the naming
 * facet's concern), and new expands a root-level `{name}` to the project name.
 */
export const layoutEntrySchema = z.strictObject({
  path: layoutPathSchema,
  required: z.boolean().default(false),
  description: z.string().optional(),
});

/**
 * Tools the project is built with. Captured configs live as real files under
 * the pattern's `toolchain/` directory; `configs` maps a source id (a repo
 * path like "biome.json", or "manifest#dotted.path" for embedded subtrees) to
 * that pattern-relative file. `binding` opts a source id out of the default
 * `subset` mode (captured keys present and equal, project extras fine):
 * `verbatim` demands byte equality, `presence` only that the file exists.
 */
export const toolchainSchema = z.strictObject({
  packageManager: z.string().optional(),
  formatter: z.string().optional(),
  linter: z.string().optional(),
  typechecker: z.string().optional(),
  testRunner: z.string().optional(),
  taskRunner: z.string().optional(),
  ci: z.string().optional(),
  /** Git-hook manager (husky, lefthook, pre-commit). */
  hooks: z.string().optional(),
  binding: z.record(z.string(), z.enum(["subset", "verbatim", "presence"])).default({}),
  configs: z
    .record(
      z.string(),
      z
        .string()
        .refine(
          (p) => p.startsWith("toolchain/") && !p.endsWith("/") && isSafePatternPath(p),
          "config captures live under the pattern's toolchain/ directory",
        ),
    )
    .default({}),
});

/**
 * Libraries the project should use, grouped by purpose. Extract writes only
 * registry-classified infrastructure choices; everything else lands in prose.
 */
export const dependenciesSchema = z.strictObject({
  /** Library per purpose, e.g. { "http-client": "httpx", orm: "sqlalchemy" }. */
  runtime: z.record(z.string(), z.string()).default({}),
  /** Development-only tooling, e.g. { test: "pytest", lint: "ruff" }. */
  dev: z.record(z.string(), z.string()).default({}),
  /**
   * How scaffolded versions are written. Cross-ecosystem buckets: `caret`
   * means any bounded compatible range (npm ^/~, pypi ~=, cargo bare),
   * `latest` means unbounded or floating.
   */
  versionPolicy: z.enum(["pinned", "caret", "latest"]).optional(),
});

/**
 * File templates captured for scaffolding. Each entry is a project-relative
 * target path (sharing layout's `{name}` segment semantics); its contents live
 * at `templates/<path>` inside the pattern directory, where `{{name}}` stands
 * for the instance name the path was expanded with and `{{project}}` for the
 * project's own name.
 */
export const scaffoldSchema = z.strictObject({
  templates: z
    .array(layoutPathSchema.refine((p) => !p.endsWith("/"), "templates are files, not directories"))
    .default([]),
});

/**
 * Canonical dev verbs mapped to the shell command each runs from the repo
 * root, e.g. { test: "bun test", lint: "biome check ." }. `new` writes them
 * into the scaffolded manifest scripts or taskfile.
 */
export const commandsSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9-]*$/, "command verbs are lowercase kebab-case"),
  // One line only: `new` writes each command as a single justfile/Makefile
  // recipe line, where a newline would smuggle in extra recipes.
  z
    .string()
    .min(1)
    .max(500)
    .refine((command) => !/[\n\r]/.test(command), "a command is a single line"),
);

/**
 * Where tests live and what they are called. `{stem}` stands for the source
 * file's basename (`user.ts` → `user.test.ts`); a pattern without `{stem}`
 * (pytest's `test_*.py` style) constrains shape only.
 */
export const testingSchema = z.strictObject({
  placement: z.enum(["colocated", "separate"]),
  filePattern: z.string().optional(),
});

/** An SPDX license id or expression, e.g. "MIT" or "(MIT OR Apache-2.0)". */
export const licenseSchema = z
  .string()
  .regex(/^[A-Za-z0-9(][A-Za-z0-9 ().+-]*$/, 'license is an SPDX id or expression, e.g. "MIT"');

/** Languages the project is written in, code and prose. */
export const languagesSchema = z.strictObject({
  /** Sanctioned programming languages, dominant first, e.g. ["TypeScript", "Bash"]. */
  programming: z.array(z.string()).default([]),
  /** Runtime version pins, e.g. { node: ">=22", python: ">=3.12" }. */
  versions: z.record(z.string(), z.string()).default({}),
  /** Natural language of docs and comments (BCP 47 primary subtag, e.g. "en"). */
  natural: z.string().optional(),
});

/**
 * How commit messages are written, voted from history under ADR-0005's
 * exception. `types` and `scope` are only meaningful for the conventional
 * style; `subject` is the case of the subject line's first letter.
 */
export const commitsSchema = z.strictObject({
  style: z.enum(["conventional", "gitmoji", "free"]),
  /** Conventional types in use, e.g. ["feat", "fix", "docs"]. */
  types: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).default([]),
  scope: z.enum(["required", "optional", "never"]).optional(),
  subject: z.enum(["lower", "sentence"]).optional(),
});

/** How versions are cut: the tag shape, the changelog's style, the tool that runs it. */
export const releasesSchema = z.strictObject({
  versioning: z.enum(["semver", "calver"]).optional(),
  changelog: z.enum(["keep-a-changelog", "generated"]).optional(),
  tool: z.string().optional(),
});

/**
 * The machine-readable half of a pattern: the facets the deterministic engine
 * can extract, scaffold, and check without any AI. Grows facet by facet.
 * `format` stays 1 while the schema is pre-public (ADR-0003); bump discipline
 * starts at the first public release.
 */
export const patternSchema = z.strictObject({
  format: z.literal(1).default(1),
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "pattern names are lowercase kebab-case"),
  description: z.string().default(""),
  license: licenseSchema.optional(),
  languages: languagesSchema.optional(),
  naming: namingSchema.optional(),
  layout: z.array(layoutEntrySchema).default([]),
  toolchain: toolchainSchema.optional(),
  testing: testingSchema.optional(),
  commands: commandsSchema.optional(),
  dependencies: dependenciesSchema.optional(),
  scaffold: scaffoldSchema.optional(),
  commits: commitsSchema.optional(),
  releases: releasesSchema.optional(),
});

/** The facets a pattern carries, in its own order: what `dolly extract` reports saving. */
export function facetNames(pattern: Pattern): string[] {
  return Object.entries(pattern)
    .filter(([key]) => !["format", "name", "description"].includes(key))
    .filter(([, value]) => (Array.isArray(value) ? value.length > 0 : value !== undefined))
    .map(([key]) => key);
}

/** Derives a valid pattern/project name from arbitrary text (e.g. a directory basename). */
export function slugify(raw: string, fallback: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

export type CaseStyle = z.infer<typeof caseStyleSchema>;
export type Testing = z.infer<typeof testingSchema>;
export type Commands = z.infer<typeof commandsSchema>;
export type Commits = z.infer<typeof commitsSchema>;
export type Releases = z.infer<typeof releasesSchema>;
export type Dependencies = z.infer<typeof dependenciesSchema>;
export type Naming = z.infer<typeof namingSchema>;
export type Scaffold = z.infer<typeof scaffoldSchema>;
export type LayoutEntry = z.infer<typeof layoutEntrySchema>;
export type Toolchain = z.infer<typeof toolchainSchema>;
export type Languages = z.infer<typeof languagesSchema>;
export type Pattern = z.infer<typeof patternSchema>;
