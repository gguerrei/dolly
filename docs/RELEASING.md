# Releasing dolly

What a version is made of, what the tag builds on its own, and what stays in
the maintainer's hands.

## What ships

- **The `dolly` binary**, one file per platform, with the GUI embedded:
  `bun run build:binary` (the webview built, `packages/cli/scripts/embed-ui.ts`
  writing the file imports, `bun build --compile`). `dolly serve` then serves
  the GUI from inside the binary, from any directory.
- **The npm package `dollysheep`**: `bun run build:npm` bundles the CLI with
  the engine and the GUI's files into `packages/cli/dist/`; `bin` points at
  `dist/main.js`, which needs bun on the machine (`#!/usr/bin/env bun`). The
  engine and commander are bundled in, so the published package declares no
  runtime dependencies.
- **The desktop installers** (`.dmg`, `.deb`, `.AppImage`, `.msi`): `bun run
  tauri build` in `apps/desktop`. Its `beforeBuildCommand` builds the webview
  and `packages/cli/scripts/build-sidecar.ts`, which compiles the binary as
  `src-tauri/binaries/dolly-<host triple>`; Tauri bundles it beside the app
  as its sidecar, and the shell spawns it instead of `bun dolly serve`.

## Cutting a version

1. Set the version in `packages/cli/package.json`, `packages/core/package.json`,
   `apps/desktop/package.json`, `apps/desktop/src-tauri/tauri.conf.json` and
   `apps/desktop/src-tauri/Cargo.toml`, move the changelog's Unreleased
   entries under the new heading, and commit.
2. Tag it: `git tag v0.1.0 && git push origin v0.1.0`.
3. The [release workflow](../.github/workflows/release.yml) builds the three
   binaries and the installers, opens a **draft** release carrying them, and
   publishes `dollysheep` to npm when the repository has an `NPM_TOKEN`
   secret (it says so and skips when it does not).
4. Read the draft, then publish it.
5. Homebrew: copy `packaging/homebrew/dolly.rb` into the tap
   (`gguerrei/homebrew-dolly`, `Formula/dolly.rb`), set `version` and the two
   `sha256` values (`shasum -a 256` of the release's `dolly-macos-arm64` and
   `dolly-linux-x64`), and push. `brew install gguerrei/dolly/dolly` then works.

## The pattern format

`format: 1` is fluid until v0.1.0 (ADR-0003, rule 5). From the first public
release on, a change an older dolly could misread bumps `PATTERN_FORMAT` in
`packages/core/src/pattern/schema.ts` and lands with a migration in
`pattern/document.ts`; a pattern from a newer dolly is refused with the
upgrade hint, never misread.
