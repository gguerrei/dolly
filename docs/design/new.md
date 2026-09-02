# New: design

How `dolly new <pattern> [dir]` turns a pattern into a fresh project. Built at
M3; reviewed by a five-dimension adversarial audit (2026-07-24).

## Ground rules

1. **Patterns are untrusted input.** They arrive as hand-edited files or
   `.dolly` bundles from other people. Every path a pattern supplies (layout
   entries, config source ids, template targets) passes one shared gate before
   it touches the filesystem: relative POSIX only, no `..`, no control
   characters, and no `.git`. A pattern that could write `.git/config` would
   own the repository `new` is about to create, and git executes config values
   like `core.fsmonitor` during ordinary commands. Dotted embed paths refuse
   `__proto__`/`constructor`/`prototype` separately.
2. **Refuse a non-empty target.** The only directory `new` writes into is one
   it created or found empty.
3. **Never invent, never install.** Content comes from the pattern (captured
   configs, commands, license) or from ecosystem convention (a base manifest,
   .gitignore defaults, starter files). Dependency installs are printed as
   next steps in the user's own package manager, never run. A pinned
   `versionPolicy` shapes those steps for npm today (`--exact` and friends);
   every other ecosystem gets a note saying to pin the printed installs by
   hand, rather than a flag dolly only pretended to apply.

## What gets written

- **Layout.** Directory entries become directories; a `{name}` *directory*
  segment is a module template and is instantiated exactly once, named after
  the project (`packages/{name}/` → `packages/lamb/`), with `workspaces` /
  `[workspace].members` derived for the root manifest. A `{name}` in *file*
  position (`routers/{name}.py`) is a per-resource convention with nothing to
  instantiate yet: skipped and reported. Directories that end up empty get a
  `.gitkeep` so git can carry them.
- **Configs.** Captured files return to their source paths verbatim; embedded
  subtrees (`tsconfig.json#compilerOptions`, `pyproject.toml#tool.ruff`) are
  folded back into the file they came from. Generated JSON is emitted in the
  shape formatters settle on (objects expanded, fitting arrays inline;
  package.json fully expanded), so a scaffold passes its own pattern's
  `check` with zero edits.
- **Templates.** Each `scaffold.templates` entry is instantiated at its
  expanded path, with `{{name}}` becoming the instance name and `{{project}}`
  the project name. Precedence runs in one direction: a captured toolchain
  config keeps its own bytes, a template beats anything dolly *generates* for
  that path (manifest, taskfile, LICENSE, stub), and a generic stub is the
  last resort; a template dropped for a captured config says so in a note
  rather than vanishing. A template for a per-resource path waits until there
  is a resource to name it after.
- **Base manifest.** package.json / pyproject.toml / Cargo.toml / go.mod, and
  since 2026-09-01 a Gemfile, a pom.xml (or build.gradle.kts with its
  settings file when the pattern says Gradle), a composer.json, or a .csproj
  named after the project, with name, 0.1.0, the license id, runtime pins
  (engines, requires-python, rust-version, `ruby`, the Java release, the PHP
  floor, the .NET target framework from the SDK pin), and the commands facet
  as scripts, or as a justfile/Makefile when that is the pattern's task
  runner. Maven and Gradle add no dependency from the command line, so those
  installs are printed as lines to add to the build file. Version pins are normalized to what
  each field actually parses: `requires-python` gains the operator a specifier
  needs (`3.12` → `>=3.12`), while `go` and `rust-version` lose one they
  cannot carry (`>=1.21` → `1.21`).
- **LICENSE.** Full text stamped for the common permissive set (MIT, ISC,
  BSD-2/3, Apache-2.0, Unlicense) with year and "the <name> authors";
  anything else gets a placeholder plus a note, never a guessed text.
- **Starter files.** An empty `src/` gets one entry file and an empty test
  directory gets one smoke test, so the canonical commands pass on day one
  instead of erroring on an empty tree. The test runner owns the seed's
  contents and the testing facet its name and placement: `filePattern:
  "{stem}.spec.ts"` names the seed `index.spec.ts`, and a colocated pattern
  seeds next to the entry file (its layout has no test directory to wait
  for), so a fresh scaffold passes its own pattern's testing rule.
  A tsconfig `types` entry adds its `@types/*` package to the install steps.
- **git init**, quietly; a missing git degrades to a note.

## Second audit (2026-07-27)

The M3 audit's verification tail was cut short by a usage cap, so it was rerun
from scratch: three finders over the scaffolder, the extract-side facets, and
code quality, then one skeptic re-judging every finding against the code.
Nineteen held up and were fixed here. The sharpest was a pattern naming
`.git/config` as a captured config's source path: the file was written before
`git init`, which merges its defaults in and keeps every other key, so a
`core.fsmonitor` value ran as soon as the user typed the `git add -A` that
dolly itself prints as the next step. Hence the `.git` clause in ground rule 1.

The others clustered: paths that skipped the guard (layout entries never
reached it at all), precedence that did not match this document, fingerprints
that could not tell a license from its no-attribution sibling, and captures
that carried identity. Each fix is described in the section it belongs to.

## Acceptance (ran 2026-07-24, rerun 2026-07-27)

Extract from the dolly repo itself → `dolly new dolly-style lamb` → `bun add`
steps → the fresh project passes `biome check .`, `tsc --noEmit`, and
`bun test`: its own pattern's linter and all three canonical commands.

dolly's own sibling packages and ADRs genuinely differ, so they correctly
yield notes instead of templates; a second run against a uniform monorepo
confirmed the capture path, including the scope placeholder
(`@uniform/api` → `@{{project}}/{{name}}` → `@flock/flock`) and the bundle
round-trip that carries `templates/`.
