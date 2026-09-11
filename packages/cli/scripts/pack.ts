#!/usr/bin/env bun
/**
 * Puts the license and the third-party notices beside the npm package's
 * manifest before publishing: `files` cannot reach above the package, and a
 * tarball carrying Inter under the OFL must carry the notice too. The copies
 * are generated, never committed.
 */
import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("..", import.meta.url));
const root = join(cli, "..", "..");
for (const file of ["LICENSE", "THIRD_PARTY_LICENSES.md"]) {
  await copyFile(join(root, file), join(cli, file));
}
console.log("LICENSE and THIRD_PARTY_LICENSES.md copied beside packages/cli/package.json.");
