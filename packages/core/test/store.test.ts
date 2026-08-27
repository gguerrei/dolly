import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patternSchema } from "../src/pattern/schema";
import { InvalidPatternNameError, PatternNotFoundError, PatternStore } from "../src/store";

const tempRoots: string[] = [];

async function freshStore(): Promise<PatternStore> {
  const root = await mkdtemp(join(tmpdir(), "dolly-store-"));
  tempRoots.push(root);
  return new PatternStore(join(root, "patterns"));
}

afterAll(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

function doc(name: string, description = "") {
  return { pattern: patternSchema.parse({ name, description }), prose: "" };
}

describe("PatternStore", () => {
  test("lists nothing before anything is saved", async () => {
    const store = await freshStore();
    expect(await store.list()).toEqual([]);
  });

  test("saves, lists, and loads patterns", async () => {
    const store = await freshStore();
    await store.save(doc("tidy-python", "My tidy Python setup."));
    await store.save(doc("api-service"));

    const listed = await store.list();
    expect(listed.map((p) => p.name)).toEqual(["api-service", "tidy-python"]);

    const loaded = await store.load("tidy-python");
    expect(loaded.pattern.description).toBe("My tidy Python setup.");
  });

  test("deletes a pattern", async () => {
    const store = await freshStore();
    await store.save(doc("short-lived"));
    await store.delete("short-lived");
    expect(await store.list()).toEqual([]);
  });

  test("deletes a pattern even when its pattern.md is broken", async () => {
    const store = await freshStore();
    await mkdir(join(store.root, "broken"), { recursive: true });
    await writeFile(join(store.root, "broken", "pattern.md"), "not even close");

    await store.delete("broken");
    expect(await store.list()).toEqual([]);
  });

  test("has reports whether a pattern.md exists, valid or not", async () => {
    const store = await freshStore();
    await store.save(doc("real"));
    expect(await store.has("real")).toBe(true);
    expect(await store.has("missing")).toBe(false);
  });

  test("throws PatternNotFoundError for missing patterns", async () => {
    const store = await freshStore();
    expect(store.load("nope")).rejects.toThrow(PatternNotFoundError);
    expect(store.delete("nope")).rejects.toThrow(PatternNotFoundError);
  });

  test("rejects traversal-shaped names before they ever touch the filesystem", async () => {
    const store = await freshStore();
    expect(store.load("../escape")).rejects.toThrow(InvalidPatternNameError);
    expect(store.delete("../escape")).rejects.toThrow(InvalidPatternNameError);
    const traversal = { pattern: { ...doc("valid").pattern, name: "../escape" }, prose: "" };
    expect(store.save(traversal)).rejects.toThrow(InvalidPatternNameError);
  });

  test("list skips directories that are not patterns", async () => {
    const store = await freshStore();
    await store.save(doc("real-pattern"));
    await mkdir(join(store.root, "not-a-pattern"), { recursive: true });
    await writeFile(join(store.root, "stray-file.txt"), "noise");

    const listed = await store.list();
    expect(listed.map((p) => p.name)).toEqual(["real-pattern"]);
  });

  test("list keys on directory names even when hand-edited frontmatter drifts", async () => {
    const store = await freshStore();
    await mkdir(join(store.root, "dir-name"), { recursive: true });
    await writeFile(join(store.root, "dir-name", "pattern.md"), "---\nname: other-name\n---\n");

    const listed = await store.list();
    expect(listed.map((p) => p.name)).toEqual(["dir-name"]);
    await expect(store.load("dir-name")).resolves.toBeDefined();
  });

  test("list flags a pattern whose pattern.md no longer parses, instead of hiding it", async () => {
    const store = await freshStore();
    await mkdir(join(store.root, "broken"), { recursive: true });
    await writeFile(
      join(store.root, "broken", "pattern.md"),
      "---\nname: broken\nlayotu: []\n---\n",
    );

    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe("broken");
    expect(listed[0]?.error).toContain("Invalid pattern facets");
  });
});
