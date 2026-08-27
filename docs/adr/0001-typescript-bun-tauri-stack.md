# ADR-0001: TypeScript + bun monorepo, Tauri for the desktop app

- **Status:** accepted
- **Date:** 2026-07-24

## Context

dolly needs a CLI, a sleek desktop GUI, and (later) integrations with several AI provider APIs. The maintainer works solo in the Node/Python ecosystems (no Rust toolchain installed), iteration speed matters for a multi-day greenfield build, and the project is meant to attract open-source contributors. Alternatives considered: Rust + Tauri (fastest engine, single static binary, but a daily-driver language the maintainer doesn't work in), TypeScript + Electron (simplest, but a ~150 MB app undercuts the "sleek dev tool" positioning), Python (packaging desktop apps is the perennial pain point).

## Decision

- One **TypeScript monorepo** using **bun** as runtime, package manager, and test runner, **Biome** for lint + format, strict TS everywhere.
- **`@dolly/core`** holds all logic; **`@dolly/cli`** is a thin commander layer. The desktop app (M5) is a **Tauri** shell whose webview UI drives the same engine, keeping CLI/GUI parity by construction.
- Distribution: `bun build --compile` single-file binaries for the CLI; Tauri installers for the GUI.

## Consequences

- Fast iteration, one language, the largest contributor pool, and first-class AI SDK options.
- The Rust toolchain is needed only to *build* the desktop shell (M5), not to work on dolly's logic.
- `@dolly/core` must stay free of CLI/GUI imports, enforced in review.
- Engine performance on huge repos is the trade-off vs Rust; if AST work ever needs speed, prefer WASM (web-tree-sitter) over native modules to keep compiled binaries simple.
