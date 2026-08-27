//! The native shell is a window around `dolly serve`: the daemon stays the
//! engine's one door, and no engine binding ever lives in Rust. The app spawns
//! the daemon on an ephemeral port, reads the tokened URL it prints, and points
//! the webview there; closing the app takes the daemon down with it.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

struct Daemon(Mutex<Option<Child>>);

/// src-tauri sits at apps/desktop/src-tauri; the workspace root is three up.
fn repo_root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("workspace root above src-tauri")
        .to_path_buf()
}

pub fn run() {
    tauri::Builder::default()
        // Native pickers for the webview (docs/design/gui.md, "The native shell");
        // the daemon stays the only door to the engine.
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let mut child = Command::new("bun")
                .args(["dolly", "serve", "--port", "0"])
                .current_dir(repo_root())
                .stdout(Stdio::piped())
                .spawn()
                .expect("spawn `bun dolly serve` (is bun on the PATH?)");
            let stdout = child.stdout.take().expect("daemon stdout");
            // First line: "dolly is serving at http://127.0.0.1:<port>/#token=…"
            let url = BufReader::new(stdout)
                .lines()
                .map_while(Result::ok)
                .find_map(|line| line.find("http://").map(|at| line[at..].trim().to_string()))
                .expect("daemon never printed its URL");
            app.manage(Daemon(Mutex::new(Some(child))));
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse()?))
                .title("dolly")
                .inner_size(1160.0, 800.0)
                .min_inner_size(760.0, 520.0)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the dolly shell")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(daemon) = app.try_state::<Daemon>() {
                    if let Some(mut child) = daemon.0.lock().expect("daemon lock").take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}
