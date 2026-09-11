#!/usr/bin/env bun
/**
 * Compiles dolly, GUI embedded, as the Tauri sidecar: the binary the native
 * shell spawns beside itself instead of `bun dolly serve` from a checkout.
 * Tauri wants it at src-tauri/binaries/dolly-<host triple>, which it renames
 * to `dolly` next to the app's own executable at bundle time.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TRIPLES: Record<string, string> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc",
};

const triple = TRIPLES[`${process.platform}-${process.arch}`];
if (!triple)
  throw new Error(`No Rust target triple known for ${process.platform}-${process.arch}.`);

const root = fileURLToPath(new URL("../../..", import.meta.url));
const binaries = join(root, "apps", "desktop", "src-tauri", "binaries");
await mkdir(binaries, { recursive: true });
const outfile = join(binaries, `dolly-${triple}${process.platform === "win32" ? ".exe" : ""}`);

const run = (...cmd: string[]) => {
  const child = Bun.spawnSync(cmd, { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (child.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed`);
};
run("bun", "packages/cli/scripts/embed-ui.ts");
run("bun", "build", "--compile", "packages/cli/src/main.ts", "--outfile", outfile);
console.log(`Sidecar at ${outfile}`);
