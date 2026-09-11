# Third-party notices

dolly is MIT licensed ([LICENSE](LICENSE)). What it ships alongside its own
code, and under which terms, is listed here so a binary, an npm package, or
an installer carries the notices its parts require. The full texts live in
each package under `node_modules/<name>/LICENSE` after `bun install`.

## Bundled into the `dolly` binary and the `dollysheep` package

| Package | License | Home |
|---|---|---|
| commander | MIT | https://github.com/tj/commander.js |
| fflate | MIT | https://github.com/101arrowz/fflate |
| ignore | MIT | https://github.com/kaelzhang/node-ignore |
| jsonc-parser | MIT | https://github.com/microsoft/node-jsonc-parser |
| smol-toml | BSD-3-Clause | https://github.com/squirrelchat/smol-toml |
| tinyld | MIT | https://github.com/komodojp/tinyld |
| yaml | ISC | https://eemeli.org/yaml/ |
| zod | MIT | https://zod.dev |

The language table `packages/core/src/extract/languages-data.json` is
generated from **linguist-languages** (MIT, https://github.com/ikatyang-collab/linguist-languages),
itself derived from GitHub's linguist data (MIT).

## Bundled into the GUI (served by `dolly serve`, embedded in the binary, and inside the desktop app)

| Package | License | Home |
|---|---|---|
| vue | MIT | https://vuejs.org |
| @codemirror/commands, @codemirror/lang-yaml, @codemirror/language, @codemirror/view | MIT | https://codemirror.net |
| @lezer/highlight | MIT | https://github.com/lezer-parser/highlight |

### The Inter typeface

The GUI ships the **Inter** font files (through `@fontsource-variable/inter`).
Inter is Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)
and licensed under the **SIL Open Font License, Version 1.1**, whose full
text accompanies the font in `node_modules/@fontsource-variable/inter/LICENSE`
and at https://openfontlicense.org. The OFL allows the font to be bundled,
embedded, and redistributed with software as long as this notice and the
license travel with it, which is why it is written here rather than only in
a package manifest.

## The desktop shell

`apps/desktop/src-tauri` builds on **Tauri** (MIT or Apache-2.0, https://tauri.app)
and **tauri-plugin-dialog** (same terms); their transitive Rust crates and
licenses are recorded in `apps/desktop/src-tauri/Cargo.lock`.
