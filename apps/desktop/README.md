# @dolly/desktop

dolly's GUI: a Vue 3 webview served by the local daemon. The design (the
daemon protocol, the views, and why this app never links the engine
directly) is in [docs/design/gui.md](../../docs/design/gui.md).

## Use it

```sh
bun run --cwd apps/desktop build   # once, or after UI changes
bun dolly serve --open             # serves API + GUI on one origin
```

`dolly serve` prints a URL with `#token=…`, and that token is the run's key;
the page reads it from the fragment, so open the URL exactly as printed.

## Develop it

```sh
bun dolly serve                    # terminal 1: the engine's door
bun run --cwd apps/desktop dev     # terminal 2: Vite, proxying /api
```

Then open Vite's URL with the daemon's token appended, e.g.
`http://localhost:5173/#token=<token from terminal 1>`. If the daemon is
not on its default port (36559), point the proxy at it with
`DOLLY_SERVE=http://127.0.0.1:<port>`.

## The native shell

The Tauri app (`src-tauri/`) is a window around the same pair: on launch
it spawns `dolly serve` on an ephemeral port, reads the tokened URL the
daemon prints, and points the webview there. No engine bindings in Rust,
ever, and closing the window takes the daemon down with it. The one
native thing it adds is the pickers: the dialog plugin, granted to the
daemon's origin in `src-tauri/capabilities/default.json`, puts a Browse
button beside every path field (`src/lib/native.ts`); in a plain browser
the button is absent and paths are typed.

```sh
bun run tauri dev     # builds the webview, compiles the shell, opens the window
bun run tauri build   # produces installable bundles (.app and .dmg on macOS, deb/rpm/AppImage on Linux)
```

It needs the Rust toolchain and the platform's webview libraries. On macOS
that is the Xcode Command Line Tools (WebKit ships with the system) and
rustup; open a new terminal after rustup so `cargo` is on the PATH:

```sh
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

On Linux (Debian/Ubuntu/Pop!_OS):

```sh
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

The icon set under `src-tauri/icons` is generated, not drawn: after a change
to `assets/app-icon.svg`, run `bun run tauri icon ../../assets/app-icon.svg`
from this directory (the npm CLI does it without Rust).

The shell spawns the daemon as `bun dolly serve` from the workspace root,
so it currently presumes a checkout with `bun` on the PATH; bundling a
compiled `dolly` binary as a real sidecar is release work, not M5's.
