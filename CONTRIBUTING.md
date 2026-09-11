# Contributing to dolly

Thanks for your interest in dolly! The project is pre-0.1 and under heavy development, so expect churn, and expect your feedback and patches to have real impact.

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
Code follows the approved board and the port is reviewed against it. The
boards live in [docs/design/canvas/](docs/design/canvas/README.md); the rule
itself is in [docs/PLAN.md](docs/PLAN.md), "How visual work happens".

## Commits

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(cli): add dolly show --json flag
fix(core): handle patterns with empty frontmatter
docs: clarify pattern store location in README
```

## Pull requests

- Keep PRs small and focused: one change per PR.
- All checks must pass: `bun run check`, `bun run typecheck`, `bun run --cwd apps/desktop build`, `bun test`.
- Update docs when behavior changes.

## Roadmap

See [docs/PLAN.md](docs/PLAN.md) for where the project is headed. If you want to work on something substantial, open an issue first so we can align before you invest time.
