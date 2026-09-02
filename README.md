<p align="center"><img src="assets/logo.svg" width="140" alt="dolly, a two-headed sheep"></p>

<h1 align="center">dolly</h1>

<p align="center">Save the way you build software as a pattern, then apply it anywhere.</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <!-- CI badge goes live once the GitHub remote exists:
  <a href="../../actions/workflows/ci.yml"><img src="../../actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  -->
</p>

> **Early development.** dolly is pre-0.1 and under heavy construction. Only what's listed under [Here today](#here-today) actually exists; everything else is roadmap.

## What is dolly

dolly is a local-first tool that captures how a project is organized, from lint and format configs all the way up to full architecture: folder layout, naming conventions, dependencies, code style, the natural language of docs and comments, even which programming language handles which functionality. That captured shape is a *pattern*: a small, portable, human-readable bundle you can save, share, and apply to other projects. Extraction is deterministic. dolly infers a pattern from an existing repo with no manual annotation, and writes down a counted note instead of a guess whenever the evidence falls short. An optional bring-your-own-key AI layer will sit on top for the fuzzy parts, but everything runs locally and nothing requires it.

*Named after Dolly, the first cloned sheep: with dolly, you clone how you build software. Hence the two heads.*

## Here today

- **Pattern format**: a pattern is a directory with a `pattern.md` holding YAML frontmatter facets (naming, layout, toolchain, testing, languages, dependencies, commands, license, scaffold) plus Markdown prose conventions, alongside the config files and file templates a pattern captures
- **`dolly extract`**: infer a pattern from a real project, deterministically and without annotations; anything the evidence can't support becomes a note you can read rather than a facet you'd have to unlearn. Toolchains and dependencies are read for npm, PyPI, Cargo, Go, RubyGems, Maven and Gradle, Composer, and NuGet
- **`dolly new`**: scaffold a fresh project from a pattern, producing the folder layout, captured configs back at their own paths, file templates with the project's name substituted in, a base manifest carrying your canonical commands and runtime pins, a stamped LICENSE, `git init`, and a `.dolly` marker linking the project to its pattern
- **`dolly check`**: lint-like enforcement. Ten rules verify the project against its pattern (via the marker or by name), `--fix` applies the safe autofixes (create, append, merge, never delete), `--watch` re-runs on every change, and `--json` prints the report for scripts and editors. An `ignore:` list in the `.dolly` marker sets known violations aside (counted, never fixed), so a mandated exception cannot fail CI forever. Captured configs bind as *subsets* by default, so your project can extend a config without dolly bleating; a built-in hygiene rule flags a `.env` that isn't gitignored
- **`dolly fit`**: the migration planner, covering everything check can fix plus the moves and renames it refuses, planned as a dry-run preview down to the exact relative-import rewrites each move needs. `--apply` requires a clean git tree, records a checkpoint branch (`git switch` back is the undo), and commits the result; a move fit can't account for is declined with its reason, never half-applied
- **`dolly ai`** and **`dolly learn`**: the optional, bring-your-own-key AI layer (Anthropic, OpenAI, or Google; keys in the OS keychain on macOS and Linux, or in an environment variable, the only route on Windows for now) and its three consumers. With AI on, fit labels a suggestion on the file moves it could not decide alone, and translates files written in a language the pattern does not sanction: one model call per file under `--apply`, judged by the pattern's own typecheck and test commands before any source is removed or committed. `dolly learn` watches a project and turns what changes into pattern edits you review as a diff, one at a time; the facet half of that needs no model at all, and with AI on the model also drafts convention lines from the files that changed
- **`dolly serve` + GUI**: a local, token-gated daemon serving a browser GUI where you browse the pattern library, view and edit patterns (validated on save), run check from a dashboard (fixes and live watch included), plan and apply fits, review what learn proposes, export a pattern into a project with the file in sight, and (with the native shell's pickers, or a typed path) extract, scaffold, and import without leaving the window. The native Tauri shell (`apps/desktop/src-tauri`) wraps this same webview and daemon and adds the directory pickers; it still presumes a checkout with `bun` on the PATH
- **Local pattern store**: patterns saved on your machine
- **CLI**: `dolly list`, `show`, `edit` (opens `$EDITOR`, validates on save), `delete`, `link` (writes the `.dolly` marker into an existing project; `fit --apply` does it too), `home`
- **Shareable bundles**: `dolly export` packs a pattern into a `.dolly` file anyone can `dolly import`, from a path or a URL
- **Exports for agents and editors**: `dolly export --as claude-skill | cursor | agents-md | prompt` renders the pattern as one file at the path its consumer expects, the facets as plain prose and your conventions verbatim. The `commits` and `releases` facets feed these: how messages are written and versions are cut, voted from history under [ADR-0005](docs/adr/0005-history-facets.md)

## On the roadmap

Details and milestones live in [docs/PLAN.md](docs/PLAN.md).

- Going public: single-file binaries (`bun build --compile`), npm and Homebrew distribution, Tauri installers with a compiled daemon as a true sidecar, docs visuals, a v0.1.0 release

## Development

Requires [bun](https://bun.sh) >= 1.2.

```sh
bun install
bun test            # run the test suite
bun run check       # Biome lint + format
bun run dolly list  # run the CLI from source
```

Set `DOLLY_HOME` to a scratch directory to keep experiments away from your real pattern store.

## Try it

Learn a pattern from a project you already have, then grow a new project from it:

```sh
export DOLLY_HOME="$(mktemp -d)"          # keep the experiment out of your real store

bun run dolly extract . --name my-style   # learn from this repo, or point it at your own
bun run dolly show my-style               # read what it inferred, notes and all
bun run dolly new my-style ../lamb        # scaffold a fresh project from it
bun run dolly check -C ../lamb            # the scaffold passes its own pattern's check
bun run dolly export my-style             # pack it up for someone else to import
bun run dolly export my-style --as agents-md   # or write it for a coding agent

bun run --cwd apps/desktop build          # build the GUI once…
bun run dolly serve --open                # …then browse, edit, and check it visually
```

## In CI and hooks

`dolly check` exits 1 when a violation remains and 0 when the project is clean, so it drops into any pipeline as it is; `--json` prints the same report the GUI reads, for annotations or an editor. The repository ships a [pre-commit](https://pre-commit.com) hook definition, so a project runs the check before every commit with:

```yaml
- repo: https://github.com/gguerrei/dolly
  rev: v0.1.0
  hooks:
    - id: dolly-check
```

The hook runs the `dolly` on your PATH. A violation the project has decided to live with goes in the marker's `ignore:` list, and the report says how many it set aside.

A pattern is just a directory with a `pattern.md`, so nothing is locked away: `dolly edit my-style` opens it in `$EDITOR` and validates it when you save. The YAML frontmatter holds the *facets* the deterministic engine understands; the Markdown body holds the conventions only humans (and later, the optional AI layer) can interpret.

Extraction refuses to guess. Where a project is genuinely inconsistent (mixed file naming, docs written in two languages), you get a counted note in the prose instead of a facet, which is a far better starting point for editing than a confident mistake.

## Project structure

```
packages/core   # @dollysheep/core: the engine (pattern model, extract, new/check/fit, learn, AI adapters)
packages/cli    # dollysheep: the `dolly` command, incl. the `serve` daemon
apps/desktop    # the GUI webview (Vue 3), served by `dolly serve`, and the Tauri shell (src-tauri/)
docs/           # plan, ADRs, design notes
```

## Contributing

Contributions are welcome, even this early: issues, ideas, and PRs alike. Start with [CONTRIBUTING.md](CONTRIBUTING.md) for setup and conventions (Conventional Commits), and note that the [Code of Conduct](CODE_OF_CONDUCT.md) applies everywhere in the project.

## License

[MIT](LICENSE)
