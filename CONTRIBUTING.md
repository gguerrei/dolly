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

> Tip: set `DOLLY_HOME=/tmp/dolly-dev` (or any scratch directory) while developing so CLI experiments never touch your real pattern store. When a CLI command takes flags, separate them from `bun run` with `--`, e.g. `bun run dolly -- export my-pattern --out shared.dolly`.

## Code style

- Biome enforces lint and format rules; run `bun run check` before pushing.
- TypeScript strict mode, no exceptions.
- Readability first: if a clever line needs a comment to be understood, write the boring version instead.

## Visual work

Anything a person will look at (the mark, a GUI view, an empty state, a
docs or installer visual) is designed before it is built: on a Claude Design
canvas, through the `/design` command in Claude Code, and approved there.
Code follows the approved board and the port is reviewed against it. One
exception: a small addition to an approved board that reuses its own
components and vocabulary (a button, a toggle, a tile, a row action) is
ported directly and reviewed live. The boards live in
the maintainer's design canvas, which the pull request review compares the port against.

## Commits

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(cli): add dolly show --json flag
fix(core): handle patterns with empty frontmatter
docs: clarify pattern store location in README
```

## Pull requests

- Keep PRs small and focused: one change per PR.
- All checks must pass: `bun run check`, `bun run typecheck`, `bun run --cwd apps/desktop build`, `bun test`, and `bun run --cwd apps/desktop e2e` when the GUI changed.
- Update docs when behavior changes.

## Roadmap

The README's roadmap says where the project is headed. If you want to work on something substantial, open an issue first so we can align before you invest time.
