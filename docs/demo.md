# Dolly on its own repository

The [README video](../assets/demo.mp4) runs Dolly 0.1.1 against a temporary clone of this repository at `89b08b7`. It extracts a pattern, exports agent instructions, catches a changed test command, and restores that command. The terminal scenes display the actual command output with pauses for reading. The final scene opens the running GUI.

The [animated preview](../assets/demo.gif) shows the same workflow. The walkthrough below provides a text version.

## Extract and review

With dolly installed, clone the example and use a separate pattern store for the exercise:

```sh
git clone https://github.com/gguerrei/dolly.git dolly-example
cd dolly-example
git checkout 89b08b7
export DOLLY_HOME="$(mktemp -d)"
dolly extract . --name dolly-style
dolly show dolly-style
```

The extraction reports:

```text
Saved pattern "dolly-style" (facets: license, languages, naming, layout, toolchain, testing, commands, dependencies, commits, releases; 3 configs captured).
Review it with `dolly show dolly-style`. Extraction notes list what fell short of a facet.
```

Review the pattern and its extraction notes before using it elsewhere. The notes identify mixed file layouts, unclassified dependencies, and languages represented by too little code to establish a convention.

## Export agent instructions

```sh
dolly export dolly-style --as agents-md
```

This writes `AGENTS.md` in the example repository. Here are the Testing and Commands sections from that file:

```markdown
## Testing

- Tests live in a separate test directory, named `{stem}.test.ts` where `{stem}` is the source file's basename.

## Commands

| Verb | Command |
|---|---|
| check | `biome check .` |
| test | `bun test` |
| typecheck | `tsc --noEmit` |
```

The full export also includes the inferred languages, layout, naming, toolchain, dependencies, license, commit style, release conventions, and extraction notes. You can export the pattern with `--as claude-md` or `--as cursor` to use the corresponding instruction file.

## Introduce a change

First check the repository:

```sh
dolly check dolly-style
```

```text
Clean: this project follows "dolly-style".
```

In `package.json`, change only `scripts.test` from `bun test` to `bun test --coverage`. Then run the check again:

```sh
dolly check dolly-style
```

```text
commands package.json: script "test" differs from the pattern's `bun test` [fixable]

1 violation (1 fixable; run `dolly check --fix`).
```

The command exits with status 1. This example makes a deliberate change to demonstrate the check; a coverage flag can be a valid choice for a project. You decide whether to update the pattern, record an exception, or restore the expected command.

## Restore the command

For this exercise, restore the pattern's value:

```sh
dolly check dolly-style --fix
```

The test script returns to `bun test` and the check passes. Other scripts and manifest settings are preserved.

```sh
git diff -- package.json
```

There is no remaining diff for the manifest.

## Inspect the GUI

```sh
dolly serve --open
```

Open Export, select the `dolly-style` pattern, and point it at the example repository. Choose an agent target to read the generated file before saving it.

![Agent targets and the generated instructions in Dolly's local GUI.](../assets/gui.png)

## Record the assets again

The recording script requires the repository dependencies, Playwright's Chromium, and FFmpeg with an H.264 encoder. Run these commands from the development checkout:

```sh
bun install
bun run --cwd apps/desktop build
(cd apps/desktop && bunx playwright install chromium)
bun apps/desktop/scripts/record-demo.ts
```

Set `FFMPEG` to the encoder's absolute path if it is not on your PATH. `PLAYWRIGHT_BROWSERS_PATH` can point to an existing browser installation. Pass a directory as the script's argument to write the media somewhere other than `assets/`.

The script clones the current committed revision into a temporary directory and gives it a separate pattern store. It checks the CLI exit codes, verifies that the fix restores the manifest exactly, and fails if terminal output would be clipped. Command output, exit codes, the source revision, and still frames remain in the temporary directory printed at the end.

The generated files are `demo.mp4`, `demo.gif`, and `gui.png`. The README embeds the GIF and links to the MP4, so the media can live in the repository alongside the documentation.
