<p align="center"><img src="assets/logo.svg" width="140" alt="dolly, a two-headed sheep"></p>

<h1 align="center">dolly</h1>

<p align="center">Save the way you build software as a pattern, then apply it anywhere.</p>

<p align="center">
  <a href="https://github.com/gguerrei/dolly/releases/latest"><img src="https://img.shields.io/github/v/release/gguerrei/dolly?label=release" alt="Release"></a>
  <a href="https://www.npmjs.com/package/dollysheep"><img src="https://img.shields.io/npm/v/dollysheep?label=npm" alt="npm"></a>
  <a href="https://github.com/gguerrei/dolly/actions/workflows/ci.yml"><img src="https://github.com/gguerrei/dolly/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
</p>

## What is dolly

dolly is a local tool that captures how a project is organized, from lint and format configs all the way up to architecture: folder layout, naming conventions, dependencies by purpose, the toolchain and its configs, where tests live, which commands run what, the license, how commits are written and versions are cut, and the natural language of the docs. That captured shape is a *pattern*: a small, portable, human-readable directory you can save, share, and apply to other projects. Extraction is deterministic: dolly infers a pattern from an existing repository with no annotations, and writes down a counted note instead of a guess wherever the evidence falls short. An optional bring-your-own-key AI layer sits on top for the parts only a reader can judge; everything runs on your machine, and nothing requires it.

*Named after Dolly, the first cloned sheep: with dolly, you clone how you build software. Hence the two heads.*

## Install

Every release carries the command as one file per platform with the GUI embedded, the desktop app, and the two npm packages.

```sh
brew install gguerrei/dolly/dolly     # macOS, Apple silicon, from the tap
bun add -g dollysheep                 # anywhere bun runs (bun >= 1.2; npm install -g works too, the command still needs bun)
```

Or take a binary from the [latest release](https://github.com/gguerrei/dolly/releases/latest): `dolly-macos-arm64`, `dolly-linux-x64` or `dolly-windows-x64.exe`, checked against the `SHA256SUMS` beside them, made executable and put on your PATH. The desktop app is on the same page: a `.dmg` for macOS, a `.deb` and an `.rpm` for Linux, a setup `.exe` and an `.msi` for Windows. The engine alone is `bun add @dollysheep/core`, for editors and build steps that want the library.

## Try it

Learn a pattern from a project you already have, then grow a new project from it:

```sh
dolly extract . --name my-style      # learn from a project you like
dolly show my-style                  # read what it inferred, notes and all
dolly new my-style ../lamb           # scaffold a fresh project from it
dolly check -C ../lamb               # the scaffold passes its own pattern's check
dolly export my-style                # pack it up for someone else to import
dolly export my-style --as agents-md # or write it for a coding agent
dolly serve --open                   # browse, edit, and check it in the GUI
```

`dolly ai connect anthropic` (or `openai`, `google`) turns the AI layer on with a key that goes to the OS keychain; `dolly ai --verify` proves it with one call. Set `DOLLY_HOME` to a scratch directory to keep an experiment away from your real pattern store.

## What it does

- **Pattern format**: a pattern is a directory with a `pattern.md` holding YAML frontmatter facets (naming, layout, toolchain, testing, languages, dependencies, commands, license, scaffold, commits, releases) plus Markdown prose conventions, alongside the config files and file templates it captures. `dolly edit my-style` opens it in `$EDITOR` and validates it when you save; nothing is locked away
- **`dolly extract`**: infer a pattern from a real project, deterministically and without annotations; anything the evidence cannot support becomes a note you can read rather than a facet you would have to unlearn. Toolchains and dependencies are read for npm, PyPI, Cargo, Go, RubyGems, Maven and Gradle, Composer, and NuGet, and a repository whose members carry the manifests is read through them. Given several projects, `dolly extract a b c --name style` keeps what they agree on and says what they do not
- **`dolly new`**: scaffold a fresh project from a pattern, producing the folder layout, captured configs back at their own paths, file templates with the project's name substituted in, a base manifest carrying the canonical commands and runtime pins, a stamped LICENSE, `git init`, and a `.dolly` marker linking the project to its pattern
- **`dolly check`**: lint-like enforcement. Ten rules verify the project against its pattern (via the marker or by name), `--fix` applies the safe autofixes (create, append, merge, never delete or overwrite), `--watch` re-runs on every change, and `--json` prints the report for scripts and editors. The `.dolly` marker carries the project's own word: an `ignore:` list sets known violations aside (counted, never fixed), so a mandated exception cannot fail CI forever, and a `rules:` map turns a rule off or down to a warning; `dolly ignore` and `dolly rules` edit them for you. With AI on, `--conventions` adds one model call that reads the prose conventions against the files changed since HEAD, reported apart and never counted. Captured configs bind as *subsets* by default, so a project can extend a config without dolly bleating, and a built-in hygiene rule flags a `.env` that is not gitignored
- **`dolly fit`**: the migration planner, covering everything check can fix plus the moves, renames and overwrites it refuses, planned as a dry-run preview down to the exact patch each fix makes and the relative-import rewrites each move needs. `--apply` requires a clean git tree, records a checkpoint branch (`git switch` back is the undo), and commits the result; a move fit cannot account for is declined with its reason, never half-applied
- **`dolly ai`** and **`dolly learn`**: the optional AI layer (Anthropic, OpenAI, or Google; keys in the OS keychain on macOS and Linux, sealed with DPAPI on Windows, or in an environment variable, never on a command line) and its four consumers. With AI on, fit labels a suggestion on the file moves it could not decide alone, and translates files written in a language the pattern does not sanction: one model call per file under `--apply`, judged by the pattern's own typecheck and test commands, which the dry run shows first, before any source is removed or committed. `dolly learn` watches a project and turns what changes into pattern edits you review as a diff, one at a time; the facet half of that needs no model at all, and with AI on the model also drafts convention lines from the code files that changed
- **`dolly serve` and the GUI**: a local, token-gated daemon on 127.0.0.1 serving the GUI, where you browse the pattern library, view and edit patterns and their captured files (validated on save), run check from a dashboard (fixes, live watch, the marker's ignore list and rules, and the conventions toggle included), plan and apply fits, review what learn proposes, export a pattern into a project with the file in sight, and extract, scaffold, link, and import without leaving the window. The compiled command carries the GUI inside it, and the desktop app wraps the same daemon in a native window with file pickers
- **Sharing**: `dolly export` packs a pattern into a `.dolly` file anyone can `dolly import`, from a path or an https URL, pinned to its hash with `--sha256`. `dolly link <pattern> --vendor` copies the pattern into a repository under `dolly/` so a checkout carries it, and a marker may name a bundle URL as its `source:` instead, with the same `sha256:` pin
- **Exports for agents and editors**: `dolly export --as claude-skill | claude-md | cursor | agents-md | copilot | gemini | windsurf | cline | prompt` renders the pattern as one file at the path its consumer expects, the facets as plain prose and your conventions verbatim
- **The rest of the CLI**: `list`, `show`, `delete`, `home` (`--prune` removes the bundles fetched for markers' source URLs that are older than a week), and `completions` for zsh, bash, and fish, with pattern names completing live

## In CI and hooks

`dolly check` exits 1 when a violation remains and 0 when the project is clean, so it drops into any pipeline as it is; `--json` prints the same report the GUI reads, for annotations or an editor. The repository ships a [pre-commit](https://pre-commit.com) hook definition, so a project runs the check before every commit with:

```yaml
- repo: https://github.com/gguerrei/dolly
  rev: v0.1.1
  hooks:
    - id: dolly-check
```

The hook runs the `dolly` on your PATH. A violation the project has decided to live with goes in the marker's `ignore:` list, and the report says how many it set aside. Run `dolly link <pattern> --vendor` once and commit the `dolly/` directory it writes, and CI checks against the pattern without importing anything.

## Security

dolly reads trees other people wrote and applies patterns other people made, so its lines are written down: a symlink is never followed, a pattern from elsewhere can make dolly run exactly two things and both are shown first, `check --fix` never overwrites, a pattern travels without credentials, the daemon is loopback and a token, and every release can be checked against its `SHA256SUMS`. [SECURITY.md](SECURITY.md) has the whole list and where to report a problem.

## Development

Requires [bun](https://bun.sh) >= 1.2.

```sh
bun install
bun test                          # the test suite
bun run check                     # Biome lint and format
bun run typecheck                 # tsc, strict
bun run --cwd apps/desktop build  # vue-tsc and the webview
bun run --cwd apps/desktop e2e    # the GUI walked in Chromium (after the build; Chromium once via bunx playwright install chromium)
bun run dolly list                # the CLI from source
```

```
packages/core   # @dollysheep/core: the engine (pattern model, extract, new, check, fit, learn, the AI adapters)
packages/cli    # dollysheep: the `dolly` command, including the `serve` daemon
apps/desktop    # the GUI webview (Vue 3), served by `dolly serve`, and the Tauri shell (src-tauri/)
packaging       # the Homebrew formula
```

## On the roadmap

A Linux AppImage beside the deb and the rpm, and whatever the first users ask for. Issues and ideas are welcome.

## Contributing

Contributions are welcome: issues, ideas, and PRs alike. Start with [CONTRIBUTING.md](CONTRIBUTING.md) for setup and conventions (Conventional Commits); the [Code of Conduct](CODE_OF_CONDUCT.md) applies everywhere in the project.

## License

[MIT](LICENSE)
