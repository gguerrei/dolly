# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- M0 bootstrap: TypeScript monorepo using bun workspaces.
- `@dolly/core`: pattern model (a pattern is a directory with a `pattern.md`:
  YAML frontmatter facets plus Markdown prose conventions) and a local pattern
  store.
- `@dolly/cli`: `dolly list`, `dolly show <name>`, `dolly delete <name>`, and
  `dolly home` commands.
- `dependencies` facet: libraries by purpose (runtime and dev) plus a version
  policy, completing the v1 pattern schema.
- `dolly edit <name>`: opens the pattern in `$EDITOR` and validates it on save,
  offering to reopen when the result is invalid.
- Shareable `.dolly` bundles via `dolly export <name>` and
  `dolly import <file>`, with `--force` to replace an existing pattern.
- `dolly extract [path]`: infer a pattern from a real project with no
  annotations. One inventory walk feeds five scanners (layout, naming,
  toolchain, dependencies and languages), and the config files a pattern
  depends on are captured as real files beside it. Anything the evidence
  cannot support is recorded as a counted note in the prose rather than
  guessed into a facet.
- `commands` facet: the canonical dev verbs, read from whichever task runner
  the project actually uses.
- `license` facet: the SPDX id, taken from the manifest field where there is
  one and fingerprinted from the LICENSE text otherwise.
- `scaffold` facet: file templates captured from sibling modules that agree,
  with each module's own name and package scope replaced by variables so a
  template never carries the source project's identity somewhere else.
- `dolly new <pattern> [dir]`: scaffold a fresh project from a pattern:
  folder layout, captured configs back at their source paths, templates
  instantiated for the new project, a base manifest carrying the canonical
  commands and runtime pins, a stamped LICENSE, and `git init`. Dependency
  installs are printed as next steps in your own package manager, never run.
- `dolly check [pattern] [-C dir] [--fix] [--watch]`: lint-like enforcement.
  Eight rules verify a project against its pattern (layout, naming, config
  binding, commands, license, testing, hooks, and a built-in env-hygiene
  check for a `.env` that is not gitignored). `--fix` applies the safe
  autofixes (create, append, merge; never delete, move, or rewrite text a
  human wrote) and fixing is idempotent; `--watch` re-runs on a debounce.
  Captured configs bind as subsets by default (captured keys present and
  equal, project extras welcome); `toolchain.binding` opts a config into
  `verbatim` bytes or `presence` (the file exists, its contents are yours).
  Non-JSON/TOML captures fall back to byte-equality detection but are never
  overwritten unless bound verbatim.
- `.dolly` marker: `dolly new` writes a one-line, committed marker linking a
  project to its pattern, and `dolly check` resolves the pattern from it when
  no name is given.
- `testing` facet: where tests live (colocated or separate) and their naming
  shape (`{stem}.test.ts`), voted from the test files a repo actually has.
  `dolly new` honors it when seeding starter tests: the facet names the seed
  and places it (next to the entry file for colocated patterns), so a fresh
  scaffold passes its own pattern's testing rule.
- `toolchain.hooks`: the git-hook manager (husky, lefthook, pre-commit),
  fingerprinted from its config like every other toolchain role.
- `watchProject` in the engine: the whole of `--watch` (debounce, deny-list
  pruning, no fixing by construction), so the CLI and the future GUI drive
  the same loop. `@dolly/core`'s barrel is now a curated public surface
  (one entry point per verb) instead of re-exporting internals.
- `CheckReport.diagnostics`: pattern defects (a capture file missing from
  the pattern, an unsafe source id) surface apart from the project's
  violations, so a broken pattern can never report as a clean tree.
- `dolly serve`: the engine's one local door for the GUI, an HTTP/JSON
  daemon bound to 127.0.0.1, gated by a per-run bearer token that rides the
  printed URL's fragment (never a cookie), with a Host-header check against
  DNS rebinding. Routes bind the core barrel one-to-one: patterns (list,
  read, edit-with-validation, delete), check (with fixes), and watch as a
  live NDJSON stream; the built GUI is served at `/` on the same origin.
- `apps/desktop`: the GUI, built as a Vue 3 + Vite webview with the pattern
  library, a pattern viewer/editor (validated on save, written
  byte-for-byte; a broken pattern opens straight in the editor), and a
  check dashboard with fix and live watch. An app-shell sidebar carries
  the nav and a daemon status line; the editor is CodeMirror 6 with YAML
  awareness themed from the palette itself; Inter ships self-hosted;
  saves, deletes, and fixes toast, loads show skeletons, and check reports
  render as a summary strip over per-rule groups. White/black/grey sheep
  theme, light and dark.
- The native shell: a Tauri window around `dolly serve`. It spawns the
  daemon on an ephemeral port, reads the tokened URL off its stdout,
  points the webview there, and takes the daemon down on exit. No engine
  bindings in Rust; `bun run tauri dev` in `apps/desktop` opens it,
  prerequisites in `apps/desktop/README.md`.
- `dolly fit <pattern> [--apply]`: the migration planner. It covers
  everything check can fix (the same `FixPlan`s, applied by the same
  executor) plus the moves and renames check refuses: files renamed
  to the naming facet, tests moved to the testing facet's placement
  and name shape, each move carrying the relative TS/JS import
  rewrites that keep the tree compiling, in the author's own
  specifier style (bare, `.js`-suffixed, or directory imports).
  Dry-run by default, down to the exact specifier lines; `--apply`
  refuses anything but a clean git tree, records a
  checkpoint branch (`git switch` back is the undo), and commits the
  result. A move fit cannot account for (ambiguous imports, colliding
  targets, no unambiguous destination) is declined with its reason,
  never half-applied.
- The GUI grew a fit view, and the daemon its route: `POST /api/fit`
  serves the plan as the data it already is, plus the git state so the
  UI can gate Apply; the view renders moves with their import rewrites
  as subordinate lines, fixes with their plan kind, and a "left to you"
  group carrying every declined item's reason. Apply runs only against
  a clean git tree and reports its checkpoint branch. Check's naming and
  testing messages now point at `dolly fit` instead of calling the moves
  hand-work.
- `dolly ai <status|connect|use|off>`: the AI layer's foundation.
  Bring-your-own-key adapters for Anthropic, OpenAI, and Google behind
  one interface (plain fetch, no SDKs). Keys resolve from the
  environment first, then the OS keychain through the platform's own
  tool, and `connect` stores one only after a live verification round
  trip, reading it with echo off and never as a flag. The active
  provider and model ride `ai.json` beside the pattern store; `use`
  writes it, `off` deletes it, and consumers get null while it is
  absent, so everything deterministic runs exactly as before. Windows
  keychain storage waits for a machine that can verify it; the env
  vars work everywhere.
- Semantic placement, the AI layer's first consumer: fit's ambiguous
  declines (several same-stem sources for a colocated test, several
  test roots for a separate one) now enumerate the exact destinations
  the planner refused to pick between, and with AI on the model picks
  one of them. The pick rides the plan as a labeled suggestion with a
  one-line why, printed by the CLI and rendered in the fit view. A
  reply outside the planner's own candidates is discarded, and apply
  never reads suggestions, so a wrong pick costs a shrug, not a file.
- `dolly learn [pattern] [--once] [--yes]`: learning mode. A watcher
  re-extracts the project whenever it settles and compares it with its
  pattern; every disagreement becomes a proposal (a new command verb, a
  dependency purpose, a layout entry, a captured config whose bytes moved,
  a naming or testing value that flipped). Lists only grow and nothing is
  removed. With AI on, one call at review time drafts up to five convention
  lines from the files that changed. Each proposal is reviewed as the diff
  it would make and written only on accept. The daemon carries it too:
  `GET /api/learn` streams proposals while watching, `POST /api/learn`
  writes the accepted set, `POST /api/learn/draft` asks the model once.
  The GUI's Learn view sits on those routes: proposals as panels with
  their diffs, accept or skip, Write for the accepted set.
- Cross-language translation (ADR-0004): the `languages` check rule
  reports code files written outside the pattern's `languages.programming`;
  with AI on, `dolly fit` plans a `translate` step for each (at most 25 per
  apply, 64 KiB per file, the dry run saying what would go to the model),
  and `--apply` has the model rewrite each file into the pattern's dominant
  language, runs the pattern's `typecheck` and `test` commands, and only
  then removes the sources and commits. A malformed reply or a failing
  verification commits nothing and keeps every original.
- The GUI's AI settings: every provider with where its key lives, Use,
  Connect with the key verified live before the keychain stores it, the
  model, and the switch, on `GET /api/ai/providers` and `POST
  /api/ai/{connect,use,off}`. `aiProviders()` joins the engine's barrel.
- Exports for agents and editors (M8): `dolly export --as claude-skill |
  cursor | agents-md | prompt` renders the pattern as one file at the path
  its consumer expects, every target the same brief (the facets as prose,
  the conventions verbatim) in its own frame; `--out -` prints it, and an
  existing file is refused without `--force`. The daemon previews and
  saves the text targets on `GET` and `POST /api/export`.
- The `commits` and `releases` facets, the first to read git history under
  the exception [ADR-0005](docs/adr/0005-history-facets.md) carves:
  message style, types, scopes and subject case voted from the last 200
  commits; the tag shape, the changelog's style and the release tool. A
  `releases` check rule creates a missing Keep a Changelog file and
  reports a missing tool config; `new` stamps the changelog header.
- The GUI's export view, designed on the canvas first: the shared project
  fields, the target list with the path each lands at, the rendered file
  refreshed on every change, Save into project (a file already there is a
  callout with Replace and Keep mine) and Copy. The pattern view's header
  links to it.
- The native shell's pickers (M9): the Tauri dialog plugin, granted to
  the page the daemon serves, puts a Browse button beside every path
  field; in a browser the path is typed. The flows they unlock are routes
  and panels now: Extract a project and Import a bundle from the library,
  New project from the pattern view (with the scaffold report and its
  next steps), and the bundle saved through the shell's save dialog from
  the export view, on `POST /api/{extract,new,import}` and the bundle
  target of `POST /api/export`. A name or directory already taken is a
  409 the panel turns into Replace or Keep mine. `facetNames()` joins the
  engine so the CLI and the daemon list a pattern's facets from one place.

### Changed

- The logo is a solid silhouette now: the same two-headed sheep, drawn as
  five scallops over a rounded base with the heads as the ends of the
  body and the eyes knocked out, one ink in both schemes. The app icon
  and the Tauri icon set follow it.
- The GUI looks like a shipped desktop app: a sidebar with a labeled nav
  and a status footer (the AI line from the new `GET /api/ai`, the daemon
  line), a top bar with breadcrumbs and a ⌘K palette over every view and
  pattern, the library as a table with validity badges and hover delete,
  the pattern as an overview of panels beside its Source mode, and check
  and fit reports as stat tiles over one panel per rule. Same palette,
  same behavior, both schemes.
- Naming is about code now: with a languages facet, only its extensions
  vote in extraction and only they are judged by check; an off-style
  doc or asset is neither dissent nor a violation, and directories
  participate only when they hold code. An explicit `naming.extensions`
  entry stays the author's opt-in for anything else.
- Config and manifest merges apply as minimal text edits (per key, via
  jsonc-parser): comments, tabs, indentation style, and key order all
  survive, and a tab-indented or JSONC-commented file no longer blocks
  its fixes. TOML keeps the conservative byte-identity bar.
- File-based hook managers (lefthook, pre-commit) capture their config
  like any other toolchain config: `new` writes it back, check's
  config rule recreates it when missing, and the hooks rule stands down
  where the capture owns the answer.
- A scaffolded `{name}` instance renders through the pattern's own
  naming facet per position, so a snake_case pattern scaffolded into a
  kebab-named directory still passes its own check.

- Check's autofixes are now serializable data: each violation carries a
  `FixPlan` (create, append, merge, and `write`, which is reserved for
  the `verbatim` binding) applied by one executor, so a check report travels
  as JSON. The eight rules live behind a single `Rule` contract, the
  taskfile recipe scanner is shared by extract and check, and the
  inventory walk, config serializer, and invented-file stubs moved into
  named modules (`tree/`, `serialize.ts`, `apply/content.ts`). Behavior
  is unchanged, with one tightening: a Makefile recipe headed `@name:`
  no longer matches check's scan (make gives `@` no target-level
  meaning).
- The logo: redrawn geometric. The same two-headed fleece, now one
  mirrored-math outline with a uniform stroke that stays legible at 16px,
  plus `assets/app-icon.svg`, its rounded-square tile for the native
  shell. The heads were then reshaped to the maintainer's sketch: the
  cloud turns into each head with a straight top line that rounds at the
  muzzle and returns symmetrically, the U-ear hangs from that top line
  (it used to hang from the fleece crease, across the face), and the eye
  sits beyond it, facing out.
- All of dolly's writing was reworded away from dash punctuation, by a
  standing maintainer rule: docs, code comments, CLI and GUI copy, and
  generated output alike. Report lines now separate a path from its
  message with a colon, and the scaffolded README lists each command as
  `` `verb`: `command` ``. Two em dashes remain in the tree, both inside
  test fixtures that imitate third-party bytes, which are not dolly's
  words.

### Fixed

- The remembered project directory did not show in the check, fit, and
  learn views' directory field after the component that owns it was
  extracted: a model set during the parent's own render is swallowed by
  the scheduler. It is restored once mounted.
- The MIT license text stopped fingerprinting as MIT-0 when its title
  reads "The MIT License (MIT)" or its notice-retention clause
  line-wraps mid-phrase, the exact shapes real repos ship. Clause
  checks now run against whitespace-flattened text; a wrap can never
  flip a recognition. This restores the license facet (and everything
  downstream: LICENSE stamping in `new`, license enforcement in `check`)
  on repos where it silently vanished.
- Two rules aiming a create at the same path (layout's empty stub and
  config's captured bytes, both filling the same hole) let whichever ran
  first win: a 0-byte file reported as two successful fixes, with a
  violation no later `--fix` could clear. Creates are now reconciled per
  path (contents beat stubs), and a fix whose disk guard held is
  reported as skipped, never as performed.
- Fit's ground rule 4 (a move must account for its imports or not
  happen) was only enforced for TS/JS importers, so on any other
  ecosystem "no importers found" silently read as "accounted for": fit
  would rename a Python module while `__init__.py` still imported the
  old name, and call it applied. Moves of files outside the import
  ledger's languages now decline with the reason, the presence of
  importer types the ledger cannot read (`.vue`, `.svelte`, `.astro`,
  `.mdx`) declines every move, a testing move the pattern's own layout
  contradicts declines citing the entry, and the ledger itself grew
  `.mts/.cts/.mjs/.cjs`. v1 fit's promise is restated in
  docs/design/fit.md: a TS/JS migration tool; honest declines elsewhere.

- `check --fix` could truncate files invisible to the inventory: a
  gitignored justfile, a `@generated` source file, an ignored LICENSE all
  read as "missing" and were overwritten by create-fixes. Absence is now a
  disk question; a present-but-invisible file gets its own report-only
  violation, and every create-fix re-checks the disk before writing.
- Re-extracting over an existing pattern left stale captured files (and
  templates) in the pattern directory, and exported bundles shipped them
  forever. Saving an extraction now replaces the pattern wholesale, as
  import always did.
- `check --fix` invented a root-manifest fragment when a pattern captured
  an embedded subtree (`pyproject.toml#tool.ruff`) and the project had no
  manifest; now report-only, matching the layout rule's refusal.
- A gitignored lockfile still counted as package-manager evidence,
  breaking ADR-0003's clone-state invariance.
- Bundle imports passed a weaker path gate than every other pattern input;
  they now pass `isSafePatternPath`, which also refuses `:` (drive letters
  and NTFS alternate data streams alike).
- Merge fixes reflowed whole files: a one-key `tsconfig.json` fix came
  back 2-space-reflowed, and a TOML license fix rewrote every array in the
  file. A fix is now offered only when reserializing reproduces the file
  byte-for-byte; anything else is reported for a human to merge.
- A fix that threw (permissions, disk full) escaped mid-application, and an
  error inside the watch loop killed the watcher; both are now contained
  and reported.
- npm's legacy `license: { type }` object form rendered as
  `[object Object]` in violation messages; `requires-python` and
  `rust-version` were read by regex over raw TOML instead of parsed.
- The functional review of the recovered tree (2026-08-27): a translation's
  verification ran the pattern's commands without the project's own bins on
  the PATH, so `tsc` was never found and no translation could commit; the
  AI budgets were sized for the reply alone, which a model that reasons
  first left empty or cut short; learn proposed `packages/lamb/` under a
  pattern that already lists `packages/{name}/`; a failed convention draft
  was silent; `dolly edit` left an invalid save in the store (the editor
  now works on a copy, written back only once it parses); `dolly delete`
  asks for the name on a terminal, as the GUI confirms; a missing captured
  config was reported by two rules; extract counted templates as configs;
  and the export preview demanded a directory even with the pattern named.
