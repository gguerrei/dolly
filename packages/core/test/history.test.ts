import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { scaffoldProject } from "../src/apply/new";
import { checkProject } from "../src/check/check";
import { COMMITS_TUNING, scanCommits } from "../src/extract/commits";
import { extractPattern, saveExtractedPattern } from "../src/extract/extract";
import { scanReleases } from "../src/extract/releases";
import { collectInventory } from "../src/tree/inventory";
import { cleanupTempRoots, freshStore, repo, seed } from "./support";

afterAll(cleanupTempRoots);

/** The two facets that read history, and the tree they leave untouched. */

async function git(root: string, ...args: string[]): Promise<void> {
  const child = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if ((await child.exited) !== 0) {
    throw new Error(`git ${args.join(" ")}: ${await new Response(child.stderr).text()}`);
  }
}

/** A repository with one empty commit per subject, in order, and the given tags. */
async function history(root: string, subjects: string[], tags: string[] = []): Promise<void> {
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "history@test");
  await git(root, "config", "user.name", "history test");
  for (const subject of subjects) await git(root, "commit", "-q", "--allow-empty", "-m", subject);
  for (const tag of tags) await git(root, "tag", tag);
}

const conventional = (n: number, scoped = 0) =>
  Array.from({ length: n }, (_, i) => {
    const type = ["feat", "fix", "docs", "refactor", "test"][i % 5];
    return i < scoped ? `${type}(core): change ${i}` : `${type}: change ${i}`;
  });

describe("the commits scanner", () => {
  test("votes Conventional Commits with its types, scopes, and subject case", async () => {
    const root = await repo({ "README.md": "# x\n" });
    await history(root, [...conventional(28, 2), "wip", "Merge later"]);
    const { commits, notes } = await scanCommits(root);
    expect(commits).toEqual({
      style: "conventional",
      types: ["docs", "feat", "fix", "refactor", "test"],
      scope: "optional",
      subject: "lower",
    });
    expect(notes).toEqual([]);
  });

  test("a type seen once is noise, and every commit scoped means required", async () => {
    const root = await repo({ "README.md": "# x\n" });
    await history(root, [...conventional(12, 12), "chore(core): one off"]);
    const { commits } = await scanCommits(root);
    expect(commits?.types).toEqual(["docs", "feat", "fix", "refactor", "test"]);
    expect(commits?.scope).toBe("required");
  });

  test("a style short of the bar is a counted note; a free style keeps only its case", async () => {
    const root = await repo({ "README.md": "# x\n" });
    await history(root, [
      ...conventional(12),
      ...Array.from({ length: 8 }, (_, i) => `Tidy the thing number ${i}`),
    ]);
    const { commits, notes } = await scanCommits(root);
    expect(commits).toBeUndefined();
    expect(notes).toEqual([
      "12 of 20 recent commits follow Conventional Commits; set `commits.style` by hand if intentional.",
    ]);

    const plain = await repo({ "README.md": "# x\n" });
    await history(
      plain,
      Array.from({ length: 10 }, (_, i) => `Add piece ${i}`),
    );
    expect((await scanCommits(plain)).commits).toEqual({
      style: "free",
      types: [],
      subject: "sentence",
    });
  });

  test("gitmoji subjects vote too, and a short or missing history is silence", async () => {
    const root = await repo({ "README.md": "# x\n" });
    await history(root, [
      ...Array.from({ length: 9 }, (_, i) => `✨ add feature ${i}`),
      ":bug: fix the thing",
    ]);
    expect((await scanCommits(root)).commits).toEqual({
      style: "gitmoji",
      types: [],
      subject: "lower",
    });

    const young = await repo({ "README.md": "# x\n" });
    await history(young, conventional(COMMITS_TUNING.minSample - 1));
    expect(await scanCommits(young)).toEqual({ notes: [] });
    expect(await scanCommits(await repo({ "README.md": "# x\n" }))).toEqual({ notes: [] });
  });
});

describe("the releases scanner", () => {
  test("reads the tag shape, the changelog's style, and the tool's fingerprint", async () => {
    const root = await repo({
      "README.md": "# x\n",
      "CHANGELOG.md": "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- things\n",
      ".changeset/config.json": "{}\n",
    });
    await history(root, ["init"], ["v0.1.0", "v0.2.0", "v0.3.0"]);
    expect(await scanReleases(await collectInventory(root))).toEqual({
      releases: { versioning: "semver", changelog: "keep-a-changelog", tool: "changesets" },
      notes: [],
    });
  });

  test("calver wins over semver for year-led tags; two tags are too few", async () => {
    const root = await repo({ "README.md": "# x\n" });
    await history(root, ["init"], ["2026.8.1", "2026.8.22", "pkg@2026.9.1"]);
    expect((await scanReleases(await collectInventory(root))).releases).toEqual({
      versioning: "calver",
    });
    const two = await repo({ "README.md": "# x\n" });
    await history(two, ["init"], ["v1.0.0", "v1.1.0"]);
    expect((await scanReleases(await collectInventory(two))).releases).toBeUndefined();
  });

  test("a tool that writes the changelog makes it generated; an unknown style is a note", async () => {
    const generated = await repo({
      "README.md": "# x\n",
      "pyproject.toml":
        '[project]\nname = "x"\n\n[tool.semantic_release]\nversion_variable = "x"\n',
    });
    expect((await scanReleases(await collectInventory(generated))).releases).toEqual({
      tool: "python-semantic-release",
      changelog: "generated",
    });

    const freeform = await repo({ "README.md": "# x\n", "CHANGELOG.md": "v1: stuff happened\n" });
    expect(await scanReleases(await collectInventory(freeform))).toEqual({
      notes: [
        "CHANGELOG.md exists but its style is not one dolly recognizes; set `releases.changelog` by hand.",
      ],
    });
  });

  test("a tarball and a clone differ in the two history facets and nothing else", async () => {
    const files = {
      "README.md": "# x\n",
      "package.json": JSON.stringify({
        name: "x",
        version: "1.0.0",
        scripts: { test: "bun test" },
      }),
      "src/index.ts": "export {};\n",
    };
    const clone = await repo(files);
    await history(clone, conventional(12), ["v1.0.0", "v1.1.0", "v1.2.0"]);
    const tarball = await repo(files);
    const { pattern: fromClone } = (await extractPattern(clone, "x")).document;
    const { pattern: fromTarball } = (await extractPattern(tarball, "x")).document;
    expect(fromClone.commits?.style).toBe("conventional");
    expect(fromClone.releases).toEqual({ versioning: "semver" });
    // The description names the directory (the identity exception), so it is set aside too.
    const { commits: _c, releases: _r, description: _d, ...rest } = fromClone;
    const { description: _e, ...fromTree } = fromTarball;
    expect(fromTree).toEqual(rest);
  });
});

describe("the releases rule", () => {
  test("creates the changelog by hand, reports the missing tool, and sees through gitignore", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "released",
      releases: { versioning: "semver", changelog: "keep-a-changelog", tool: "changesets" },
    });
    const root = await repo({ "README.md": "# x\n" });
    const before = await checkProject(store, "released", root);
    expect(before.violations.map((v) => `${v.path}: ${v.message}`)).toEqual([
      ".changeset/: missing: the pattern releases with changesets, which is configured by .changeset/; tool configs are never written automatically",
      "CHANGELOG.md: missing: the pattern keeps a changelog by hand, in Keep a Changelog form",
    ]);

    const fixed = await checkProject(store, "released", root, { fix: true });
    expect(fixed.fixed).toEqual([
      "CHANGELOG.md: missing: the pattern keeps a changelog by hand, in Keep a Changelog form",
    ]);
    const changelog = await Bun.file(join(root, "CHANGELOG.md")).text();
    expect(changelog).toContain("[Keep a Changelog]");
    expect(changelog).toContain("[Semantic Versioning]");
    expect(changelog).toContain("## [Unreleased]");

    await mkdir(join(root, ".changeset"));
    await writeFile(join(root, ".changeset/config.json"), "{}\n");
    expect((await checkProject(store, "released", root)).violations).toEqual([]);

    await writeFile(join(root, ".gitignore"), "CHANGELOG.md\n");
    expect((await checkProject(store, "released", root)).violations.map((v) => v.path)).toEqual([
      "CHANGELOG.md",
    ]);
  });

  test("a captured release config gets a create-fix; the releases rule stands down", async () => {
    // The config rides toolchain.configs the way a hook manager's does.
    const source = await repo({
      "cliff.toml": '[changelog]\nheader = "# Changelog"\n',
      "src/main.rs": "fn main() {}\n",
      "Cargo.toml": '[package]\nname = "x"\nversion = "0.1.0"\n',
    });
    const { document, files } = await extractPattern(source, "cliffed");
    expect(document.pattern.releases?.tool).toBe("git-cliff");
    expect(document.pattern.toolchain?.configs["cliff.toml"]).toBe("toolchain/cliff.toml");
    expect(files["toolchain/cliff.toml"]).toContain("[changelog]");

    const store = await freshStore();
    await saveExtractedPattern(store, { document, files });
    const bare = await repo({
      "src/main.rs": "fn main() {}\n",
      "Cargo.toml": '[package]\nname = "y"\nversion = "0.1.0"\n',
    });
    const before = await checkProject(store, "cliffed", bare);
    // One violation, the config rule's, with a fix; not the releases rule's shrug on top.
    expect(before.violations.map((v) => `${v.rule} ${v.path}`)).toEqual(["config cliff.toml"]);
    expect(before.violations[0]?.fix?.kind).toBe("create");
    expect((await checkProject(store, "cliffed", bare, { fix: true })).violations).toEqual([]);

    // And a fresh scaffold carries the config, so it passes its own check.
    const target = join(await repo({}), "fresh");
    await scaffoldProject(store, "cliffed", target);
    expect(await Bun.file(join(target, "cliff.toml")).text()).toContain("[changelog]");
    expect((await checkProject(store, "cliffed", target)).violations).toEqual([]);
  });

  test("new stamps the changelog so a fresh project passes its own check", async () => {
    const store = await freshStore();
    await seed(store, { name: "released", releases: { changelog: "keep-a-changelog" } });
    const target = join(await repo({}), "fresh");
    await scaffoldProject(store, "released", target);
    expect(await Bun.file(join(target, "CHANGELOG.md")).text()).toContain("## [Unreleased]");
    expect((await checkProject(store, "released", target)).violations).toEqual([]);
  });
});
