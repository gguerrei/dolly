import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import {
  exportBundle,
  InvalidBundleError,
  importBundle,
  PatternExistsError,
} from "../src/export/bundle";
import { parsePatternDocument } from "../src/pattern/document";
import { PatternNotFoundError, PatternStore } from "../src/store";

const tempRoots: string[] = [];

async function freshDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dolly-bundle-"));
  tempRoots.push(dir);
  return dir;
}

async function freshStore(): Promise<PatternStore> {
  return new PatternStore(join(await freshDir(), "patterns"));
}

afterAll(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

const SAMPLE = `---
name: tidy-python
description: My tidy Python setup.
dependencies:
  runtime:
    http-client: httpx
  dev:
    test: pytest
  versionPolicy: pinned
---

Keep modules small.
`;

describe("bundles", () => {
  test("export then import round-trips a pattern", async () => {
    const source = await freshStore();
    const target = await freshStore();
    await source.save(parsePatternDocument(SAMPLE));

    const bundle = await exportBundle(source, "tidy-python", join(await freshDir(), "out.dolly"));
    const pattern = await importBundle(target, bundle);

    expect(pattern.name).toBe("tidy-python");
    expect(pattern.dependencies?.runtime["http-client"]).toBe("httpx");
    expect(await target.load("tidy-python")).toEqual(await source.load("tidy-python"));
  });

  test("export refuses a pattern that does not exist", async () => {
    const store = await freshStore();
    expect(exportBundle(store, "nope")).rejects.toThrow(PatternNotFoundError);
  });

  test("import refuses a file that is not a bundle", async () => {
    const store = await freshStore();
    const file = join(await freshDir(), "not-a-bundle.dolly");
    await writeFile(file, "plain text");
    expect(importBundle(store, file)).rejects.toThrow(InvalidBundleError);
  });

  test("import refuses a bundle without a pattern.md", async () => {
    const store = await freshStore();
    const file = join(await freshDir(), "empty.dolly");
    await writeFile(file, zipSync({ "readme.txt": strToU8("hello") }));
    expect(importBundle(store, file)).rejects.toThrow(/no pattern.md/);
  });

  test("a rejected bundle changes nothing, even with force and a hostile entry order", async () => {
    const store = await freshStore();
    await store.save(parsePatternDocument(SAMPLE));
    const file = join(await freshDir(), "sneaky.dolly");
    await writeFile(
      file,
      zipSync({ "../escaped.txt": strToU8("gotcha"), "pattern.md": strToU8(SAMPLE) }),
    );

    expect(importBundle(store, file, { force: true })).rejects.toThrow(
      /escapes the pattern directory/,
    );
    expect((await store.load("tidy-python")).pattern.description).toBe("My tidy Python setup.");
    expect(readFile(join(store.root, "..", "escaped.txt"))).rejects.toThrow();
  });

  test("a bundle passes the same path gate as every other pattern input", async () => {
    const store = await freshStore();
    const file = join(await freshDir(), "gitty.dolly");
    await writeFile(
      file,
      zipSync({
        "pattern.md": strToU8(SAMPLE),
        ".git/config": strToU8("[core]\n\tfsmonitor = evil\n"),
      }),
    );
    expect(importBundle(store, file)).rejects.toThrow(/escapes the pattern directory/);
    expect(await store.has("tidy-python")).toBe(false);
  });

  test("import refuses absurdly large bundles", async () => {
    const store = await freshStore();
    const entries: Record<string, Uint8Array> = { "pattern.md": strToU8(SAMPLE) };
    for (let i = 0; i < 300; i++) entries[`padding-${i}.txt`] = strToU8("x");
    const file = join(await freshDir(), "bomb.dolly");
    await writeFile(file, zipSync(entries));

    expect(importBundle(store, file)).rejects.toThrow(/too big to be a pattern/);
    expect(await store.has("tidy-python")).toBe(false);
  });

  test("import names the bundle when its pattern.md is invalid", async () => {
    const store = await freshStore();
    const file = join(await freshDir(), "bad.dolly");
    await writeFile(file, zipSync({ "pattern.md": strToU8("not a pattern") }));
    expect(importBundle(store, file)).rejects.toThrow(/contains an invalid pattern.md/);
  });

  test.skipIf(process.platform === "win32")(
    "export skips symlinks so bundles never leak outside files",
    async () => {
      const store = await freshStore();
      await store.save(parsePatternDocument(SAMPLE));
      const secret = join(await freshDir(), "secret.txt");
      await writeFile(secret, "hunter2");
      await symlink(secret, join(store.dirOf("tidy-python"), "leak.txt"));

      const bundle = await exportBundle(store, "tidy-python", join(await freshDir(), "b.dolly"));
      const entries = unzipSync(new Uint8Array(await readFile(bundle)));
      expect(Object.keys(entries)).toEqual(["pattern.md"]);
    },
  );

  test("import refuses to overwrite unless forced, and force fully replaces", async () => {
    const source = await freshStore();
    const target = await freshStore();
    await source.save(parsePatternDocument(SAMPLE));
    const bundle = await exportBundle(source, "tidy-python", join(await freshDir(), "b.dolly"));

    await importBundle(target, bundle);
    await writeFile(join(target.root, "tidy-python", "stray.txt"), "old cruft");
    expect(importBundle(target, bundle)).rejects.toThrow(PatternExistsError);

    await importBundle(target, bundle, { force: true });
    expect(readFile(join(target.root, "tidy-python", "stray.txt"))).rejects.toThrow();
    expect((await target.load("tidy-python")).pattern.name).toBe("tidy-python");
  });
});
