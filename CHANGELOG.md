# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- M0 bootstrap: TypeScript monorepo using bun workspaces.
- `@dollysheep/core`: pattern model (a pattern is a directory with a `pattern.md`:
  YAML frontmatter facets plus Markdown prose conventions) and a local pattern
  store.
- `dollysheep`: `dolly list`, `dolly show <name>`, `dolly delete <name>`, and
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
  the same loop. `@dollysheep/core`'s barrel is now a curated public surface
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

- `dolly link <pattern>` writes the `.dolly` marker into a project that
  already exists (keeping an ignore list already there), and `fit --apply`
  adds the marker as a create step when it is missing, so a fitted project
  resolves its pattern by itself from then on. The daemon has it as
  `POST /api/link`.
- The marker carries an `ignore:` list: relative paths with `*` and `**`,
  a directory entry covering everything under it. An ignored violation is
  neither reported nor fixed by any rule, fit never plans for it, and the
  report says how many it set aside. A marker that does not parse is a
  diagnostic, never silence.
- `dolly check --json` prints the report in the daemon's wire shape (one
  line per report under `--watch`), for CI and editors.
- `dolly import` takes an https URL as well as a path, under the same
  size caps as a file.
- A `.pre-commit-hooks.yaml` at the repository root, so a project can run
  `dolly check` before every commit through pre-commit.
- Four more ecosystems in the toolchain and dependency scanners and in
  `new`: RubyGems (Gemfile and its groups, bundler, rubocop, rspec or
  minitest, the ruby pin), the JVM through Maven or Gradle (pom.xml or the
  build file, checkstyle and detekt configs, junit, the Java release),
  Composer (composer.json, php-cs-fixer or pint, phpstan or psalm, phpunit
  or pest, the php floor), and NuGet (every project file in a solution, the
  test project as dev, xunit, nunit or mstest, the SDK pin). The purpose
  registry carries the libraries that matter in each, a scaffold from such
  a pattern writes the right manifest, seeds its test runner, and passes
  its own check, and `*_spec.rb`, `*Test.php`, and `*Tests.cs` are test
  shapes the testing facet knows.
- `dolly extract a b c --name style` learns from several projects at once:
  each is extracted on its own, a facet is kept when a majority carry it
  and every carrier agrees, a JSON or TOML config keeps the keys every
  copy shares, and whatever was left out is named in the notes with each
  project's own notes after them. The daemon takes `dirs` for the same.
- Every fix step in a fit plan carries the patch it would make, a unified
  diff of the file as it stands, computed by the same functions apply
  writes with; the dry run prints it under the step's line, cut short
  past a dozen lines, and the daemon serves it with the plan.
- `dolly completions zsh|bash|fish` prints a completion script rendered
  from the command tree, so it cannot drift from it; pattern names
  complete live from `dolly list`, and directory arguments as
  directories. The script's header says where to install it.
- The pattern view renders the conventions from their markdown (headings
  in the panel's own vocabulary, bullets as a list, code spans as chips,
  links to http(s) only, everything else escaped), folding past three
  notes behind Show all; the fit view shows each fix's patch as a diff
  under its row, a dozen lines and then Show all. Both boards were
  approved on the canvas first.
- A checkout carries its pattern: `dolly link <pattern> --vendor` copies the
  pattern directory into the project under `dolly/` and the marker's new
  `source:` points there, so CI and a teammate's clone check without an
  import; `source:` also takes an https URL to a bundle, fetched per run
  under import's caps. Every verb that takes a project resolves through one
  function, and the daemon's link route takes `vendor`.
- The marker's `rules:` turns a rule `off` (its violations dropped and
  counted with the ignored) or down to `warn` (reported with a warning
  severity that never trips the exit code), and `dolly ignore <paths...>`
  appends to the ignore list from the terminal, as `POST /api/ignore` does
  for the GUI.
- `dolly check --conventions`: with AI on, one model call reads the prose
  conventions against the code files changed since HEAD (at most 25 files,
  64 KiB each, 200 KiB in all, the rest named as skipped) and reports what it
  sees in its own section, labeled with the model and never counted; the
  daemon takes `conventions` on its check route.
- Five more export frames, each the same brief: `claude-md` (CLAUDE.md),
  `copilot` (.github/copilot-instructions.md), `gemini` (GEMINI.md),
  `windsurf` (.windsurf/rules/<name>.md) and `cline` (.clinerules/<name>.md),
  in the CLI, the daemon, and the export view.
- `dolly ai --verify` makes one live call and reports the provider's verdict
  on the active key.
- The GUI reaches everything the CLI does: the library's extract panel
  takes several projects, the pattern view links a project (with the
  vendored copy) and edits captured configs and templates as tabs beside
  `pattern.md` in Source mode, and the check view shows the ignored count,
  a warning badge on rules the marker turned down, an ignore action on
  every row, and a Conventions toggle. The daemon serves a pattern's files
  on `GET` and `PUT /api/patterns/:name/files/<path>`, and the CLI edits
  one with `dolly edit <name> <file>`.
- The release mechanics: `bun run build:binary` compiles dolly with the GUI
  embedded (one file import per webview asset, generated by
  `packages/cli/scripts/embed-ui.ts`), `bun run build:npm` bundles the
  `dollysheep` package the same way, and `tauri build` compiles the binary as
  the native shell's sidecar, which the shell spawns instead of `bun dolly
  serve`. A `v*` tag runs `.github/workflows/release.yml`: the three
  binaries, the installers, a draft release, and the npm publish when an
  `NPM_TOKEN` secret exists; `docs/RELEASING.md` has the steps and
  `packaging/homebrew/dolly.rb` the formula. The shell passes
  `dolly serve --exit-with-parent`, so the daemon stops when the window is
  gone however it went.
- Windows keys: `dolly ai connect` seals the key through DPAPI for the
  current user into `<dollyHome>/keys/<provider>.dpapi`, and lookup unseals
  it; nothing is ever plaintext on disk.
- The pattern format's bump discipline (ADR-0003, amended): `PATTERN_FORMAT`
  is one constant, a pattern from a newer dolly is refused with the upgrade
  hint, and an older format is told to re-extract.
- The open source set is complete: `THIRD_PARTY_LICENSES.md` (Inter under
  the OFL among them), `SUPPORT.md`, `CODEOWNERS`, dependabot, a pinned
  `.bun-version` that CI honors, a publishable `dollysheep` manifest, and the
  session log moved to `docs/log.md`. The npm tarball carries the license,
  its own README and the third-party notices, and the desktop bundles carry
  the notices as resources.
- A marker's `source:` URL can be pinned with `sha256:`, and `dolly import
  --sha256` pins a bundle the same way: the bytes must hash to it or nothing
  is read.
- `bun run version:set <version>` writes the version into every file that
  carries one, and `bun run version:check` (run by CI) fails when they
  disagree.
- A `{name}` group lists its eight best supported core paths and counts the
  rest in a note, so a module shape with many shared files cannot push the
  layout past its budget.
- A marker's `source:` URL is fetched under the dolly home, one copy per URL
  and pin, read again for an hour instead of fetched, and `dolly home
  --prune` removes the copies older than a week.
- A repository without a root manifest (a tree of samples, a monorepo whose
  members carry their own) takes its toolchain and ecosystem from the
  members' vote, role by role, the dissenters named in the notes; a
  pattern's ecosystem is read from its package manager first, and `new`
  writes no manifest at the root when the layout keeps it in each member.
- The marker is edited in place: `dolly ignore --remove`, a `dolly rules`
  verb (`naming=warn hooks=off`, `on` clears), `POST /api/marker`, and a
  `.dolly` panel in the check view with the ignored paths and the ten rules
  as three-state rows.

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

- The naming vote covers the names that abstained: a style becomes a facet
  only when it also holds for the single-word stems that match several
  styles, since check judges every name. dolly's own repository voted
  `files: PascalCase` from its Vue components while ninety single-word
  modules abstained, and check then reported seventy false violations; it
  now emits no facet and a note that says why. An extension too small for
  its own override whose every name still fails the files convention is
  noted too, with the `naming.extensions` entry that settles it, and
  pytest's `test_` prefix is idiom like Go's `_test` suffix: never a vote,
  and kept through a rename.
- The `languages` rule judges with the extractor's own bar: a language the
  tree carries below two files and one percent of the code bytes (or five
  files) is a trace, which extract would not have sanctioned either, so a
  lone Dockerfile, Makefile, or helper script is never reported and never
  planned for translation. Extract and check read the tree through one
  classification.
- A release tool's root config file (`cliff.toml`, `.goreleaser.yml`,
  `release-please-config.json`, the `.releaserc` family, `.versionrc`,
  `.cz.toml`) is captured into `toolchain.configs` the way a hook
  manager's is, so `new` writes it back, the config rule creates it when
  missing, and the releases rule stands down for a captured one; a
  scaffold from a pattern that names a tool passes its own check again.

- The packages are named for npm: the CLI is `dollysheep` (the command is
  still `dolly`), the engine `@dollysheep/core`, and the GUI
  `@dollysheep/desktop`, since `dolly` and `dolly-cli` are taken; the
  Homebrew formula keeps the name `dolly`.

### Fixed

- The completion scripts `dolly completions` wrote failed their shells'
  parsers: case arms were joined with the two characters backslash and n,
  and an embedded apostrophe was quoted with two backslashes. The test now
  hands each script to the shell's own parser.
- Structural directory names (`src`, `tests`, `lib`, `docs`, the layout
  stoplist) carry the ecosystem's case, so naming neither votes on them nor
  judges them; a PSR-4 pattern no longer flags `src/` and `tests/`, and its
  scaffold passes its own check.
- The testing rule counts only the languages facet's code extensions as
  tests (a `Tests.csproj` is a project file), compares a naming shape
  against its own extension only, knows camelCase source sets ending in
  `Test` or `Tests` (`commonTest`, `iosAppUITests`) as test roots, and files
  a diagnostic instead of a violation when the layout itself demands a test
  file out of placement (a scaffold from such a pattern passes its own check
  again).
- The template identity gate reads the manifests of the four newer
  ecosystems (a gemspec, pom.xml, the Gradle settings, composer.json, a
  solution or project file, `.slnx` included) and judges a template's path
  along with its text; the layout vote drops core paths carrying the source
  project's name. A .NET repository's versioned API docs no longer travel
  into every scaffold.
- A `.gitkeep` marks its directory and never becomes a shared file, and an
  instance under any `{name}` entry's directory chain is not drift, so learn
  stops proposing a scaffold's own placeholders and instance directories.
- A placement suggestion that failed says so on the declined item (`aiError`),
  in the CLI and the fit view, and `dolly ai --verify` makes one live call so
  a revoked key shows in status rather than inside a consumer.
- When two rules want one file, the decline names both and waits for the
  first rule's move, or says the move is the author's when that one was
  declined too; a fit apply where nothing landed removes its checkpoint branch
  and says the tree is as it was.
- `dolly extract` on a file or a missing path says so plainly, and an
  extraction that found no facets says the directory was not recognizable as
  a project.
- Multi-repo extract emits `languages.programming` only when the
  repositories agree on the dominant language.
- The pattern view's dependencies panel renders one column when a pattern
  has only runtime or only development dependencies, and the settings view
  names translation among what AI does.
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
- The pre-public sweep (2026-09-01), run as extract on four real
  repositories followed by each pattern's own check on its source: a
  dual-licensed crate's `LICENSE-MIT` and `LICENSE-APACHE` were not
  license files, so every such repository was told its LICENSE was
  missing; the root and workspace manifests carry a `license` field now,
  as dolly's own pattern demands; the settings view's unused
  environment-variable helper is gone and `vue-tsc` flags unused locals
  from here on; and the design docs stopped describing the native shell
  and the bundle export as still to come.
