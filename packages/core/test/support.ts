import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { patternSchema } from "../src/pattern/schema";
import { PatternStore } from "../src/store";

/**
 * The fixture helpers every suite shares. Each suite registers the cleanup
 * itself: `afterAll(cleanupTempRoots)`.
 */

const tempRoots: string[] = [];

export async function cleanupTempRoots(): Promise<void> {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

export async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

/** Builds a throwaway repo from {path: contents}; "dir/" entries make empty dirs. */
export async function repo(files: Record<string, string>): Promise<string> {
  const root = await tempDir("dolly-test-repo-");
  for (const [path, contents] of Object.entries(files)) {
    if (path.endsWith("/")) {
      await mkdir(join(root, path), { recursive: true });
      continue;
    }
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  return root;
}

export async function freshStore(): Promise<PatternStore> {
  return new PatternStore(join(await tempDir("dolly-test-store-"), "patterns"));
}

/** Saves a hand-written pattern (through the schema, so defaults apply). */
export async function seed(store: PatternStore, facets: Record<string, unknown>): Promise<void> {
  await store.save({ pattern: patternSchema.parse(facets), prose: "" });
}
