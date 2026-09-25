# Contributing to dolly

Thanks for your interest in dolly! The project is at its first release, so expect it to move quickly, and expect your feedback to shape it.

## Prerequisites

- [bun](https://bun.sh/docs/installation) >= 1.2 (runtime, package manager, and test runner)

## Getting started

```sh
git clone https://github.com/gguerrei/dolly.git
cd dolly
bun install
bun test
```

## Dev commands

| Command | What it does |
| --- | --- |
| `bun run check` | Lint + format (Biome) |
| `bun run typecheck` | Type-check (tsc, strict) |
| `bun run --cwd apps/desktop build` | Type-check the GUI (vue-tsc) and build the webview |
| `bun test` | Run the test suite |
| `bun run --cwd apps/desktop e2e` | Walk every GUI view in Chromium against a daemon over a seeded store (`apps/desktop/e2e`); needs the webview built and, once, `bunx playwright install chromium` from `apps/desktop` |
| `bun run dolly <args>` | Run the CLI from source |
| `bun run --cwd apps/desktop tauri dev` | Open the desktop app around the daemon from the checkout; needs Rust (`apps/desktop/README.md`) |
| `bun run build:binary`, `bun run build:npm`, `bun run build:core` | The three release builds: the binary with the GUI embedded, the `dollysheep` package, the `@dollysheep/core` package |

> Tip: set `DOLLY_HOME=/tmp/dolly-dev` (or any scratch directory) while developing so CLI experiments never touch your real pattern store. When a CLI command takes flags, separate them from `bun run` with `--`, e.g. `bun run dolly -- export my-pattern --out shared.dolly`.

## Code style

- Biome enforces lint and format rules; run `bun run check` before pushing.
- TypeScript strict mode, no exceptions.
- Readability first: if a clever line needs a comment to be understood, write the boring version instead.
- Comments, docs and commit messages are plain prose that says why, never what the code already says; a comma or a colon where a dash would go.
- Every fix carries its test, and every behavior change updates the words that describe it.

## Visual work

Anything a person will look at (the mark, a GUI view, an empty state, an
installer visual) is designed before it is built and approved on the
maintainer's design canvas (Claude Design). Open an issue with what you
have in mind, or attach a mockup, and the board comes first; code follows
the approved board and the pull request review compares the port against
it. One exception: a small addition to an approved view that reuses its
own components and vocabulary (a button, a toggle, a tile, a row action)
is ported directly and reviewed live.

## Commits

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(cli): add dolly show --json flag
fix(core): handle patterns with empty frontmatter
docs: clarify pattern store location in README
```

## Pull requests

- Keep PRs small and focused: one change per PR.
- All checks must pass: `bun run check`, `bun run typecheck`, `bun run --cwd apps/desktop build`, `bun test`, and `bun run --cwd apps/desktop e2e` when the GUI changed. CI runs the same on Ubuntu, macOS and Windows.
- Update the words when behavior changes: the README, the package READMEs, `SECURITY.md` when a trust line moves. The changelog gets its line at release time.
- A change to `.github/workflows` keeps every action pinned to a commit.
- A security problem is not a pull request or an issue; see [SECURITY.md](SECURITY.md).

## Releases

The maintainer cuts them: a `v*` tag builds the binaries, the installers and
a draft release with `SHA256SUMS`; publishing the draft is what sends
`@dollysheep/core` and `dollysheep` to npm and updates the Homebrew tap.
Versions follow semver, and the pattern format bumps with a migration
whenever an older dolly could misread a pattern.

## Roadmap

The README's roadmap says where the project is headed. If you want to work on something substantial, open an issue first so we can align before you invest time.
