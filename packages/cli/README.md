# dollysheep

`dolly` extracts a repository's conventions into a reusable pattern. Export
that pattern as agent instructions, check projects for drift, or use it to
start another project. Extraction and standard checks run locally without
an LLM or an API key.

The npm package requires Bun >= 1.2, including when installed with npm.
The [standalone binaries](https://github.com/gguerrei/dolly/releases/latest)
include their runtime.

```sh
bun add -g dollysheep
dolly extract . --name my-style
dolly show my-style
dolly export my-style --as agents-md
dolly check my-style
```

Review the extracted pattern before using it elsewhere. The export writes
`AGENTS.md` in the current directory and refuses to replace an existing file.
Use `--out AGENTS.dolly.md` to inspect a separate copy. Export targets also
include Claude Code, Cursor, Copilot, Gemini, Windsurf, and Cline.

`dolly serve --open` opens the included local GUI. On macOS with Apple
silicon, you can also install through `brew install gguerrei/dolly/dolly`.
The engine is available separately as `@dollysheep/core`.

See the [demo and documentation](https://github.com/gguerrei/dolly) for the
workflow, desktop downloads, and setup instructions. The optional AI layer
supports your own provider key. [SECURITY.md](https://github.com/gguerrei/dolly/blob/main/SECURITY.md)
describes the trust model.

MIT licensed. Bundled dependency notices are in `THIRD_PARTY_LICENSES.md`.
