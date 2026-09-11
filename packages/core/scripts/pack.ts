#!/usr/bin/env bun
/**
 * Makes `packages/core/dist/` a package of its own: the bundled engine and
 * its declarations are already there (`bun run build:core` puts them
 * first), and this adds the manifest that names them, the README, the
 * license and the third-party notices. The engine publishes from `dist`,
 * so the source manifest keeps pointing at `src/` for the monorepo and
 * nothing in it changes at release time.
 */
import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import source from "../package.json";

const core = fileURLToPath(new URL("..", import.meta.url));
const root = join(core, "..", "..");
const dist = join(core, "dist");

const manifest = {
  name: source.name,
  version: source.version,
  description: source.description,
  license: source.license,
  homepage: "https://github.com/gguerrei/dolly#readme",
  repository: {
    type: "git",
    url: "git+https://github.com/gguerrei/dolly.git",
    directory: "packages/core",
  },
  bugs: "https://github.com/gguerrei/dolly/issues",
  keywords: ["scaffold", "lint", "project-structure", "conventions", "patterns", "bun"],
  type: "module",
  main: "./index.js",
  types: "./index.d.ts",
  exports: { ".": { types: "./index.d.ts", default: "./index.js" } },
  engines: { bun: ">=1.2" },
  dependencies: source.dependencies,
  publishConfig: { access: "public" },
};
await Bun.write(join(dist, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await copyFile(join(core, "README.md"), join(dist, "README.md"));
for (const file of ["LICENSE", "THIRD_PARTY_LICENSES.md"]) {
  await copyFile(join(root, file), join(dist, file));
}
console.log(`packages/core/dist is ${manifest.name}@${manifest.version}, ready to publish from.`);
