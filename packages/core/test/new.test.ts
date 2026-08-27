import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { scaffoldProject, TargetNotEmptyError } from "../src/apply/new";
import { extractPattern, saveExtractedPattern } from "../src/extract/extract";
import { isSafePatternPath, patternSchema } from "../src/pattern/schema";
import { cleanupTempRoots, freshStore, repo, seed, tempDir } from "./support";

afterAll(cleanupTempRoots);

const exists = (path: string) => Bun.file(path).exists();
const readJson = async (path: string) =>
  JSON.parse(await Bun.file(path).text()) as Record<string, unknown>;

describe("scaffoldProject", () => {
  test("extract → new round-trips a TypeScript CLI project", async () => {
    const source = await repo({
      "README.md": "# widget\n\nA tidy tool.\n",
      LICENSE: "MIT License\n\nCopyright (c) 2020 Someone\n",
      "package.json": JSON.stringify({
        name: "widget",
        version: "1.0.0",
        engines: { node: ">=22" },
        scripts: { test: "bun test", lint: "biome check .", build: "bun build src/index.ts" },
        dependencies: { commander: "^12.0.0", zod: "^4.0.0" },
        devDependencies: { "@biomejs/biome": "^2.0.0" },
      }),
      "biome.json": JSON.stringify({ formatter: { enabled: true }, linter: { enabled: true } }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
      ".gitignore": "node_modules/\n",
      "bun.lock": "{}",
      "src/index.ts": "export {};\n",
      "src/commands/init.ts": "export {};\n",
      "src/commands/build.ts": "export {};\n",
      "src/commands/dev.ts": "export {};\n",
      "test/index.test.ts": "",
    });
    const store = await freshStore();
    await saveExtractedPattern(store, await extractPattern(source, "widget"));

    const target = join(await tempDir("dolly-new-target-"), "my-fresh-app");
    const report = await scaffoldProject(store, "widget", target);

    expect(report.projectName).toBe("my-fresh-app");
    const manifest = await readJson(join(target, "package.json"));
    expect(manifest.name).toBe("my-fresh-app");
    expect(manifest.license).toBe("MIT");
    expect(manifest.engines).toEqual({ node: ">=22" });
    expect(manifest.scripts).toEqual({
      build: "bun build src/index.ts",
      lint: "biome check .",
      test: "bun test",
    });

    // Captured configs land back where they came from.
    expect(await readJson(join(target, "biome.json"))).toEqual({
      formatter: { enabled: true },
      linter: { enabled: true },
    });
    expect(await readJson(join(target, "tsconfig.json"))).toEqual({
      compilerOptions: { strict: true },
    });

    const license = await Bun.file(join(target, "LICENSE")).text();
    expect(license).toContain("MIT License");
    expect(license).toContain("the my-fresh-app authors");

    const readme = await Bun.file(join(target, "README.md")).text();
    expect(readme).toContain("# my-fresh-app");
    expect(readme).toContain("`test`: `bun test`");

    expect(report.skipped).toContain("src/commands/{name}.ts"); // per-resource file template
    expect(await Bun.file(join(target, "src", "index.ts")).text()).toBe("export {};\n");
    expect(await Bun.file(join(target, "test", "index.test.ts")).text()).toContain("bun:test");
    expect(await exists(join(target, ".gitignore"))).toBe(true);
    expect(await exists(join(target, ".git", "HEAD"))).toBe(true);
    expect(report.nextSteps.join("\n")).toContain("bun add");
    expect(report.nextSteps.join("\n")).toContain("@biomejs/biome");
    expect(report.nextSteps.join("\n")).toContain("typescript"); // tsc is not a builtin
  });

  test("workspace {name} templates are instantiated once, named after the project", async () => {
    const source = await repo({
      "package.json": JSON.stringify({ name: "mono", workspaces: ["packages/*"] }),
      "packages/api/package.json": JSON.stringify({ name: "@mono/api" }),
      "packages/api/src/index.ts": "export const api = {};\n",
      "packages/api/tsconfig.json": '{ "extends": "../../tsconfig.json" }\n',
      "packages/web/package.json": JSON.stringify({ name: "@mono/web" }),
      "packages/web/src/index.ts": "export const web = {};\n",
      "packages/web/tsconfig.json": '{ "extends": "../../tsconfig.json" }\n',
    });
    const store = await freshStore();
    await saveExtractedPattern(store, await extractPattern(source, "mono"));

    const target = join(await tempDir("dolly-new-target-"), "herd");
    const report = await scaffoldProject(store, "mono", target);

    const root = await readJson(join(target, "package.json"));
    expect(root.private).toBe(true);
    expect(root.workspaces).toEqual(["packages/*"]);
    // The member manifest comes from the captured template, so the source
    // project's scope is replaced rather than carried into the new project.
    const member = await readJson(join(target, "packages", "herd", "package.json"));
    expect(member.name).toBe("@herd/herd");
    expect(await Bun.file(join(target, "packages", "herd", "tsconfig.json")).text()).toBe(
      '{ "extends": "../../tsconfig.json" }\n',
    );
    // `export const api` / `export const web` agree once each member's own
    // name is placeheld, so the shape survives and the instance is renamed.
    expect(await Bun.file(join(target, "packages", "herd", "src", "index.ts")).text()).toBe(
      "export const herd = {};\n",
    );
    expect(report.notes.join("\n")).toContain("Instantiated");
  });

  test("extract → new round-trips a Python service with embedded tool config", async () => {
    const source = await repo({
      "pyproject.toml": [
        "[project]",
        'name = "shepherd"',
        'license = "Apache-2.0"',
        'requires-python = ">=3.12"',
        'dependencies = ["httpx==0.27.0", "fastapi==0.111.0"]',
        "",
        "[tool.ruff]",
        "line-length = 100",
      ].join("\n"),
      "app/main.py": "",
      "tests/test_app.py": "",
      "uv.lock": "",
    });
    const store = await freshStore();
    await saveExtractedPattern(store, await extractPattern(source, "shepherd"));

    const target = join(await tempDir("dolly-new-target-"), "flock");
    await scaffoldProject(store, "shepherd", target);

    const pyproject = await Bun.file(join(target, "pyproject.toml")).text();
    expect(pyproject).toContain('name = "flock"');
    expect(pyproject).toContain('license = "Apache-2.0"');
    expect(pyproject).toContain('requires-python = ">=3.12"');
    expect(pyproject).toContain("[tool.ruff]");
    expect(pyproject).toContain("line-length = 100");
    expect(await Bun.file(join(target, "LICENSE")).text()).toContain("Apache License");

    const report = await scaffoldProject(store, "shepherd", `${target}-again`);
    expect(report.nextSteps.join("\n")).toContain("uv add");
  });

  test("refuses a non-empty target directory", async () => {
    const store = await freshStore();
    await seed(store, { name: "tidy" });
    const target = await tempDir("dolly-new-occupied-");
    await writeFile(join(target, "keep.txt"), "mine");
    expect(scaffoldProject(store, "tidy", target)).rejects.toThrow(TargetNotEmptyError);
  });

  test("expands root-level {name} and gitkeeps empty directories", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "grouped",
      layout: [
        { path: "{name}/", required: false },
        { path: "{name}/data/", required: false },
        { path: "docs/", required: true },
        { path: "routers/{name}.py", required: false },
      ],
    });
    const target = join(await tempDir("dolly-new-target-"), "petal");
    const report = await scaffoldProject(store, "grouped", target);

    expect(await exists(join(target, "petal", "data", ".gitkeep"))).toBe(true);
    expect(await exists(join(target, "docs", ".gitkeep"))).toBe(true);
    expect(report.skipped).toEqual(["routers/{name}.py"]);
  });

  test("a license without stored text degrades to a placeholder and a note", async () => {
    const store = await freshStore();
    await seed(store, { name: "copyleft", license: "GPL-3.0-only" });
    const target = join(await tempDir("dolly-new-target-"), "gnu-ish");
    const report = await scaffoldProject(store, "copyleft", target);

    expect(await Bun.file(join(target, "LICENSE")).text()).toContain("GPL-3.0-only");
    expect(report.notes.join("\n")).toContain("placeholder");
  });

  test("a hostile config source id is skipped with a note, never written", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "hostile",
      toolchain: { configs: { "bad\u0000name.txt": "toolchain/x", "../escape": "toolchain/y" } },
    });
    const target = join(await tempDir("dolly-new-target-"), "safe");
    const report = await scaffoldProject(store, "hostile", target);

    const unsafe = report.notes.filter((n) => n.includes("not a safe relative path"));
    expect(unsafe).toHaveLength(2);
    expect(await exists(join(target, ".git", "HEAD"))).toBe(true); // scaffold still completed
  });

  test("writes a .PHONY, tab-indented Makefile when the task runner is make", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "makey",
      languages: { programming: ["Rust"] },
      toolchain: { taskRunner: "make" },
      commands: { test: "cargo test", build: "cargo build" },
    });
    const target = join(await tempDir("dolly-new-target-"), "mk");
    await scaffoldProject(store, "makey", target);

    const makefile = await Bun.file(join(target, "Makefile")).text();
    expect(makefile.startsWith(".PHONY: ")).toBe(true);
    expect(makefile).toContain("test:\n\tcargo test"); // the tab is load-bearing for make
    expect(makefile).toContain("build:\n\tcargo build");
  });

  test("writes a justfile when the pattern's task runner is just", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "justy",
      languages: { programming: ["Rust"] },
      toolchain: { taskRunner: "just" },
      commands: { test: "cargo test", build: "cargo build" },
    });
    const target = join(await tempDir("dolly-new-target-"), "crab");
    await scaffoldProject(store, "justy", target);

    const justfile = await Bun.file(join(target, "justfile")).text();
    expect(justfile).toContain("test:\n  cargo test");
    const cargo = await Bun.file(join(target, "Cargo.toml")).text();
    expect(cargo).toContain('name = "crab"');
    expect(cargo).not.toContain("scripts"); // commands live in the justfile, not the manifest
  });

  test("a pattern can never write into .git: git's own config survives untouched", async () => {
    const store = await freshStore();
    // The config key is a free-form source id, so only the scaffolder can stop it.
    await seed(store, {
      name: "gitcfg",
      toolchain: { configs: { ".git/config": "toolchain/gitconfig" } },
    });
    await mkdir(join(store.dirOf("gitcfg"), "toolchain"), { recursive: true });
    await writeFile(
      join(store.dirOf("gitcfg"), "toolchain", "gitconfig"),
      '[core]\n\tfsmonitor = "touch /tmp/dolly-pwned"\n',
    );
    const target = join(await tempDir("dolly-new-target-"), "guarded");
    const report = await scaffoldProject(store, "gitcfg", target);

    // git init still runs, so .git/config exists, with git's contents, not the pattern's.
    expect(await Bun.file(join(target, ".git", "config")).text()).not.toContain("fsmonitor");
    expect(report.notes.join("\n")).toContain("not a safe relative path");
  });

  test("layout, template and config paths all refuse .git at the schema too", () => {
    expect(() => patternSchema.parse({ name: "l", layout: [{ path: ".git/hooks/" }] })).toThrow();
    expect(() =>
      patternSchema.parse({ name: "t", scaffold: { templates: [".git/hooks/pre-commit"] } }),
    ).toThrow();
  });

  test("a layout entry naming a path as both file and directory keeps the directory", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "clash",
      layout: [{ path: "src/" }, { path: "src" }],
    });
    const target = join(await tempDir("dolly-new-target-"), "collide");
    const report = await scaffoldProject(store, "clash", target);

    // The directory won, so it is the one carrying a .gitkeep.
    expect(await exists(join(target, "src", ".gitkeep"))).toBe(true);
    expect(report.notes.join("\n")).toContain("both a file and a directory");
  });

  test("an embed key that reaches for the prototype chain is refused by name", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "polluted",
      languages: { programming: ["TypeScript"] },
      toolchain: { configs: { "package.json#__proto__.polluted": "toolchain/x" } },
    });
    await mkdir(join(store.dirOf("polluted"), "toolchain"), { recursive: true });
    await writeFile(join(store.dirOf("polluted"), "toolchain", "x"), '"yes"');

    const target = join(await tempDir("dolly-new-target-"), "clean");
    const report = await scaffoldProject(store, "polluted", target);

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(report.notes.join("\n")).toContain("not a safe key path");
  });

  test("a license id that names an Object member degrades instead of crashing", async () => {
    const store = await freshStore();
    await seed(store, { name: "proto", license: "constructor" });
    const target = join(await tempDir("dolly-new-target-"), "ctor");
    const report = await scaffoldProject(store, "proto", target);

    expect(await Bun.file(join(target, "LICENSE")).text()).toContain("constructor");
    expect(report.notes.join("\n")).toContain("placeholder");
  });

  test("a version pin carrying an operator is written bare where the manifest demands it", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "gopher",
      languages: { programming: ["Go"], versions: { go: ">=1.21" } },
    });
    const target = join(await tempDir("dolly-new-target-"), "gob");
    await scaffoldProject(store, "gopher", target);

    expect(await Bun.file(join(target, "go.mod")).text()).toContain("\ngo 1.21\n");
  });

  test("a template outranks what dolly generates, but yields to a captured config", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "layered",
      languages: { programming: ["Rust"] },
      toolchain: { taskRunner: "just", configs: { "rustfmt.toml": "toolchain/rustfmt.toml" } },
      commands: { test: "cargo test" },
      scaffold: { templates: ["justfile", "rustfmt.toml"] },
    });
    const dir = store.dirOf("layered");
    await mkdir(join(dir, "templates"), { recursive: true });
    await mkdir(join(dir, "toolchain"), { recursive: true });
    await writeFile(join(dir, "toolchain", "rustfmt.toml"), "edition = 2021\n");
    await writeFile(join(dir, "templates", "justfile"), "test:\n  cargo nextest run\n");
    await writeFile(join(dir, "templates", "rustfmt.toml"), "edition = 1999\n");

    const target = join(await tempDir("dolly-new-target-"), "layers");
    const report = await scaffoldProject(store, "layered", target);

    // The template wins over the justfile dolly would have generated...
    expect(await Bun.file(join(target, "justfile")).text()).toContain("cargo nextest run");
    // ...but the captured config keeps its own bytes, and says so.
    expect(await Bun.file(join(target, "rustfmt.toml")).text()).toContain("2021");
    expect(report.notes.join("\n")).toContain("a captured config already owns rustfmt.toml");
  });

  test("a captured taskfile keeps its bytes; the commands facet is not written over it", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "taskowner",
      languages: { programming: ["Rust"] },
      toolchain: { taskRunner: "just", configs: { justfile: "toolchain/justfile" } },
      commands: { test: "cargo test" },
    });
    const dir = store.dirOf("taskowner");
    await mkdir(join(dir, "toolchain"), { recursive: true });
    await writeFile(join(dir, "toolchain", "justfile"), "test:\n  cargo nextest run --all\n");

    const target = join(await tempDir("dolly-new-target-"), "owned");
    const report = await scaffoldProject(store, "taskowner", target);

    expect(await Bun.file(join(target, "justfile")).text()).toContain("cargo nextest run --all");
    expect(report.notes.join("\n")).toContain("commands facet was not written");
  });

  test("a file that is another file's parent yields to the directory instead of crashing", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "nested",
      toolchain: {
        configs: { "tool.cfg": "toolchain/flat", "tool.cfg/inner.cfg": "toolchain/deep" },
      },
    });
    const dir = store.dirOf("nested");
    await mkdir(join(dir, "toolchain"), { recursive: true });
    await writeFile(join(dir, "toolchain", "flat"), "flat\n");
    await writeFile(join(dir, "toolchain", "deep"), "deep\n");

    const target = join(await tempDir("dolly-new-target-"), "deep");
    const report = await scaffoldProject(store, "nested", target);

    expect(await Bun.file(join(target, "tool.cfg", "inner.cfg")).text()).toBe("deep\n");
    expect(report.notes.join("\n")).toContain("both a file and a directory");
  });

  test("a bare {name} in file position is per-resource, never an empty project-named file", async () => {
    const store = await freshStore();
    await seed(store, { name: "bare", layout: [{ path: "{name}" }, { path: "docs/" }] });
    const target = join(await tempDir("dolly-new-target-"), "petunia");
    const report = await scaffoldProject(store, "bare", target);

    expect(report.skipped).toEqual(["{name}"]);
    expect(await exists(join(target, "petunia"))).toBe(false);
  });

  test("the path gate matches .git case-insensitively and configs refuse backslashes", () => {
    expect(isSafePatternPath(".GIT/config")).toBe(false);
    expect(isSafePatternPath("hooks/.Git.")).toBe(false); // Windows strips the trailing dot
    expect(isSafePatternPath("src/index.ts")).toBe(true);
    expect(() =>
      patternSchema.parse({
        name: "w",
        toolchain: { configs: { "biome.json": "toolchain/..\\..\\evil" } },
      }),
    ).toThrow();
  });

  test("a multi-line command is refused by the schema, so no recipe can be smuggled in", () => {
    expect(() =>
      patternSchema.parse({ name: "sneaky", commands: { test: "bun test\nevil:\n  rm -rf /" } }),
    ).toThrow();
  });
});
