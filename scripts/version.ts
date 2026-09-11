#!/usr/bin/env bun
/**
 * One version for the files that carry it. `bun run version:set 0.1.0` writes
 * it into every one; `bun run version:check` fails when they disagree, which
 * CI runs so a release cannot ship two numbers (docs/RELEASING.md).
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Each file and the first match that is its own version, not a dependency's. */
const CARRIERS: { path: string; pattern: RegExp }[] = [
  { path: "packages/cli/package.json", pattern: /"version": "([^"]+)"/ },
  { path: "packages/core/package.json", pattern: /"version": "([^"]+)"/ },
  { path: "apps/desktop/package.json", pattern: /"version": "([^"]+)"/ },
  { path: "apps/desktop/src-tauri/tauri.conf.json", pattern: /"version": "([^"]+)"/ },
  { path: "apps/desktop/src-tauri/Cargo.toml", pattern: /^version = "([^"]+)"/m },
  {
    path: "apps/desktop/src-tauri/Cargo.lock",
    pattern: /name = "dolly-desktop"\nversion = "([^"]+)"/,
  },
];

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const [arg] = process.argv.slice(2);
const carried = await Promise.all(
  CARRIERS.map(async ({ path, pattern }) => {
    const text = await readFile(join(root, path), "utf8");
    const version = text.match(pattern)?.[1];
    if (!version) throw new Error(`${path} carries no version this script can read.`);
    return { path, pattern, text, version };
  }),
);

if (arg === "--check" || arg === undefined) {
  const versions = new Set(carried.map((c) => c.version));
  for (const { path, version } of carried) console.log(`${version}\t${path}`);
  if (versions.size > 1) {
    console.error("The versions disagree; `bun run version:set <version>` sets them all.");
    process.exit(1);
  }
  process.exit(0);
}

if (!SEMVER.test(arg))
  throw new Error(`"${arg}" is not a semver version (e.g. 0.1.0 or 0.2.0-rc.1).`);
for (const { path, pattern, text } of carried) {
  await writeFile(
    join(root, path),
    text.replace(pattern, (match, old: string) => match.replace(old, arg)),
  );
  console.log(`${arg}\t${path}`);
}
