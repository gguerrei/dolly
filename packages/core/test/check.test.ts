import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { scaffoldProject } from "../src/apply/new";
import { checkProject } from "../src/check/check";
import { exportBundle } from "../src/export/bundle";
import { extractPattern, saveExtractedPattern } from "../src/extract/extract";
import {
  ignorePaths,
  linkProject,
  type PatternRef,
  readPatternMarker,
  resolvePattern,
} from "../src/marker";
import { cleanupTempRoots, freshStore, repo, seed, tempDir } from "./support";

afterAll(cleanupTempRoots);

const messages = (report: { violations: { rule: string; message: string; path: string }[] }) =>
  report.violations.map((v) => `${v.rule} ${v.path}: ${v.message}`).join("\n");

describe("checkProject", () => {
  const WIDGET_REPO: Record<string, string> = {
    "README.md": "# widget\n",
    LICENSE: "MIT License\n\nCopyright (c) 2020 Someone\n",
    "package.json": JSON.stringify({
      name: "widget",
      version: "1.0.0",
      license: "MIT",
      scripts: { test: "bun test", lint: "biome check .", build: "bun build src/index.ts" },
      devDependencies: { "@biomejs/biome": "^2.0.0" },
    }),
    "biome.json": JSON.stringify({ formatter: { enabled: true }, linter: { enabled: true } }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
    ".gitignore": "node_modules/\n",
    "bun.lock": "{}",
    "src/index.ts": "export {};\n",
    "test/index.test.ts": "import {} from 'bun:test';\n",
  };

  test("a fresh scaffold passes its own pattern's check, via the .dolly marker", async () => {
    const store = await freshStore();
    await saveExtractedPattern(store, await extractPattern(await repo(WIDGET_REPO), "widget"));
    const target = join(await tempDir("dolly-check-target-"), "lamb");
    await scaffoldProject(store, "widget", target);

    expect(await readPatternMarker(target)).toBe("widget");
    const report = await checkProject(store, "widget", target);
    expect(messages(report)).toBe("");
    expect(report.violations).toEqual([]);
  });

  test("seeded violations are found, fixed, and fixing twice changes nothing", async () => {
    const store = await freshStore();
    await saveExtractedPattern(store, await extractPattern(await repo(WIDGET_REPO), "widget"));
    const target = join(await tempDir("dolly-check-target-"), "ewe");
    await scaffoldProject(store, "widget", target);

    // Seed one violation per fixable rule.
    await unlink(join(target, "README.md")); // layout: required file gone
    await writeFile(join(target, "tsconfig.json"), '{\n  "compilerOptions": {}\n}\n'); // config: captured key gone
    const manifest = JSON.parse(await Bun.file(join(target, "package.json")).text()) as {
      scripts: Record<string, string>;
      license: string;
    };
    delete manifest.scripts.lint; // commands: verb gone
    manifest.license = "Apache-2.0"; // license: field drifted
    await writeFile(join(target, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(target, ".env.local"), "SECRET=1\n"); // env: not gitignored

    const found = await checkProject(store, "widget", target);
    expect(found.violations.map((v) => v.rule).sort()).toEqual([
      "commands",
      "config",
      "env",
      "layout",
      "license",
    ]);
    expect(found.violations.every((v) => v.fix)).toBe(true);

    const fixed = await checkProject(store, "widget", target, { fix: true });
    expect(fixed.fixed).toHaveLength(5);
    expect(messages(fixed)).toBe("");

    // Idempotence: the tree is clean, so a second --fix has nothing to do.
    const again = await checkProject(store, "widget", target, { fix: true });
    expect(again.fixed).toEqual([]);
    expect(again.violations).toEqual([]);

    expect(await Bun.file(join(target, "README.md")).exists()).toBe(true);
    const tsconfig = await Bun.file(join(target, "tsconfig.json")).text();
    expect(JSON.parse(tsconfig)).toEqual({ compilerOptions: { strict: true } });
    const fixedManifest = JSON.parse(await Bun.file(join(target, "package.json")).text()) as {
      scripts: Record<string, string>;
      license: string;
    };
    expect(fixedManifest.scripts.lint).toBe("biome check .");
    expect(fixedManifest.license).toBe("MIT");
    expect(await Bun.file(join(target, ".gitignore")).text()).toContain(".env.local");
  });

  test("subset binding tolerates project extras and merges without losing them", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "subsetty",
      toolchain: { configs: { "biome.json": "toolchain/biome.json" } },
    });
    await mkdir(join(store.dirOf("subsetty"), "toolchain"), { recursive: true });
    await writeFile(
      join(store.dirOf("subsetty"), "toolchain", "biome.json"),
      '{ "formatter": { "enabled": true } }\n',
    );

    const extended = await repo({
      "biome.json": '{ "formatter": { "enabled": true, "indentWidth": 4 }, "extra": 1 }\n',
    });
    expect((await checkProject(store, "subsetty", extended)).violations).toEqual([]);

    const drifted = await repo({
      "biome.json": '{\n  "formatter": {\n    "enabled": false\n  }\n}\n',
    });
    const report = await checkProject(store, "subsetty", drifted, { fix: true });
    expect(report.violations).toEqual([]);
    expect(JSON.parse(await Bun.file(join(drifted, "biome.json")).text())).toEqual({
      formatter: { enabled: true },
    });

    // The merge keeps project extras while restoring captured keys.
    const both = await repo({
      "biome.json": '{\n  "formatter": {\n    "enabled": false,\n    "indentWidth": 4\n  }\n}\n',
    });
    await checkProject(store, "subsetty", both, { fix: true });
    expect(JSON.parse(await Bun.file(join(both, "biome.json")).text())).toEqual({
      formatter: { enabled: true, indentWidth: 4 },
    });
  });

  test("verbatim binding wants the exact bytes back", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "verby",
      toolchain: {
        configs: { "biome.json": "toolchain/biome.json" },
        binding: { "biome.json": "verbatim" },
      },
    });
    await mkdir(join(store.dirOf("verby"), "toolchain"), { recursive: true });
    const captured = '{ "formatter": { "enabled": true } }\n';
    await writeFile(join(store.dirOf("verby"), "toolchain", "biome.json"), captured);

    const project = await repo({
      "biome.json": '{ "formatter": { "enabled": true }, "extra": 1 }\n',
    });
    const found = await checkProject(store, "verby", project);
    expect(messages(found)).toContain("verbatim");
    await checkProject(store, "verby", project, { fix: true });
    expect(await Bun.file(join(project, "biome.json")).text()).toBe(captured);
  });

  test("an unstructured capture that drifted is reported but never clobbered", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "editier",
      toolchain: { configs: { ".editorconfig": "toolchain/.editorconfig" } },
    });
    await mkdir(join(store.dirOf("editier"), "toolchain"), { recursive: true });
    await writeFile(
      join(store.dirOf("editier"), "toolchain", ".editorconfig"),
      "indent_size = 2\n",
    );

    const edited = await repo({ ".editorconfig": "indent_size = 4\n" });
    const report = await checkProject(store, "editier", edited, { fix: true });
    expect(report.fixed).toEqual([]);
    expect(messages(report)).toContain("byte equality");
    expect(await Bun.file(join(edited, ".editorconfig")).text()).toBe("indent_size = 4\n");

    // A missing file is still created, since creation cannot lose work.
    const bare = await repo({ "README.md": "hi\n" });
    const created = await checkProject(store, "editier", bare, { fix: true });
    expect(created.violations).toEqual([]);
    expect(await Bun.file(join(bare, ".editorconfig")).text()).toBe("indent_size = 2\n");
  });

  test("presence binding wants the file to exist and nothing more", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "presenty",
      toolchain: {
        configs: { ".editorconfig": "toolchain/.editorconfig" },
        binding: { ".editorconfig": "presence" },
      },
    });
    await mkdir(join(store.dirOf("presenty"), "toolchain"), { recursive: true });
    await writeFile(
      join(store.dirOf("presenty"), "toolchain", ".editorconfig"),
      "indent_size = 2\n",
    );

    const diverged = await repo({ ".editorconfig": "totally different\n" });
    expect((await checkProject(store, "presenty", diverged)).violations).toEqual([]);

    const missing = await repo({ "README.md": "hi\n" });
    const report = await checkProject(store, "presenty", missing);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.fix).toBeDefined();
  });

  test("a JSONC config's comments survive the merge that fixes it", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "commented",
      toolchain: { configs: { "tsconfig.json": "toolchain/tsconfig.json" } },
    });
    await mkdir(join(store.dirOf("commented"), "toolchain"), { recursive: true });
    await writeFile(
      join(store.dirOf("commented"), "toolchain", "tsconfig.json"),
      '{ "compilerOptions": { "strict": true } }\n',
    );

    const project = await repo({
      "tsconfig.json": '{\n  // keep this comment\n  "compilerOptions": {}\n}\n',
    });
    const report = await checkProject(store, "commented", project, { fix: true });
    expect(report.fixed).toHaveLength(1);
    expect(report.violations).toEqual([]);
    const after = await Bun.file(join(project, "tsconfig.json")).text();
    expect(after).toContain("keep this comment");
    expect(after).toContain('"strict": true');
  });

  test("a gitignored config is invisible: reported, never read or rewritten", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "hidden",
      toolchain: { configs: { "tsconfig.json": "toolchain/tsconfig.json" } },
    });
    await mkdir(join(store.dirOf("hidden"), "toolchain"), { recursive: true });
    await writeFile(
      join(store.dirOf("hidden"), "toolchain", "tsconfig.json"),
      '{ "compilerOptions": { "strict": true } }\n',
    );
    const project = await repo({
      ".gitignore": "tsconfig.json\n",
      "tsconfig.json": '{ "compilerOptions": {} }\n',
    });
    const report = await checkProject(store, "hidden", project, { fix: true });
    expect(report.fixed).toEqual([]);
    expect(messages(report)).toContain("invisible to the pattern's eyes");
    expect(await Bun.file(join(project, "tsconfig.json")).text()).toBe(
      '{ "compilerOptions": {} }\n',
    );
  });

  test("naming violations are reported, never autofixed", async () => {
    const store = await freshStore();
    await seed(store, { name: "kebabby", naming: { files: "kebab-case" } });
    const project = await repo({ "src/FooBar.ts": "export {};\n" });

    const report = await checkProject(store, "kebabby", project, { fix: true });
    expect(report.fixed).toEqual([]);
    expect(report.violations).toHaveLength(1);
    expect(messages(report)).toContain('"FooBar" is not kebab-case');
  });

  test("testing placement and file pattern are enforced, report-only", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "testy",
      testing: { placement: "separate", filePattern: "{stem}.test.ts" },
    });
    const project = await repo({
      "src/foo.ts": "export {};\n",
      "src/foo.test.ts": "", // colocated in a separate-placement pattern
      "tests/bar.spec.ts": "", // right place, wrong naming shape
      "tests/baz.test.ts": "", // conforming
    });
    const report = await checkProject(store, "testy", project, { fix: true });
    expect(report.fixed).toEqual([]);
    expect(report.violations.map((v) => v.path)).toEqual(["src/foo.test.ts", "tests/bar.spec.ts"]);
  });

  test("the testing rule judges code, and a shape only against its own extension", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "xunit",
      languages: { programming: ["C#", "JavaScript"] },
      testing: { placement: "separate", filePattern: "{stem}Tests.cs" },
    });
    const project = await repo({
      "tests/Cart.Tests/Cart.Tests.csproj": "<Project />\n", // a project file, never a test
      "tests/Cart.Tests/CartTests.cs": "",
      "tests/Cart.Tests/PriceTest.cs": "", // its own extension, so its shape is judged
      "website/tests/links.test.mjs": "", // another ecosystem's test: placement only
      "website/src/links.test.mjs": "",
    });
    const report = await checkProject(store, "xunit", project);
    expect(report.violations.map((v) => v.path)).toEqual([
      "tests/Cart.Tests/PriceTest.cs",
      "website/src/links.test.mjs",
    ]);
  });

  test("a test file the pattern's own layout demands in place is not misplaced", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "docsy",
      layout: [{ path: "docs_src/{name}/test_main.py", required: false }],
      testing: { placement: "separate" },
    });
    const project = await repo({
      "docs_src/app01/main.py": "",
      "docs_src/app01/test_main.py": "",
      "src/test_other.py": "",
    });
    const report = await checkProject(store, "docsy", project);
    expect(report.violations.map((v) => v.path)).toEqual(["src/test_other.py"]);
  });

  test("structural directory names carry the ecosystem's case, never the author's", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "psr",
      languages: { programming: ["PHP"] },
      naming: { files: "PascalCase", directories: "PascalCase" },
    });
    const project = await repo({
      "src/Cookie/Jar.php": "<?php\n",
      "src/Handler/Curl.php": "<?php\n",
      "tests/Cookie/JarTest.php": "<?php\n",
      "tests/handlers/CurlTest.php": "<?php\n",
    });
    const report = await checkProject(store, "psr", project);
    expect(report.violations.map((v) => v.path)).toEqual(["tests/handlers/"]);
  });

  test("TOML manifests get the license field checked, comments blocking the rewrite", async () => {
    const store = await freshStore();
    await seed(store, { name: "crabby", license: "MIT" });

    const drifted = await repo({
      "Cargo.toml": '[package]\nname = "crab"\nlicense = "Apache-2.0"\n\n',
      LICENSE: "MIT License\n\nCopyright (c) 2020 Someone\n",
    });
    const report = await checkProject(store, "crabby", drifted, { fix: true });
    expect(report.violations).toEqual([]);
    expect(await Bun.file(join(drifted, "Cargo.toml")).text()).toContain('license = "MIT"');

    const commented = await repo({
      "Cargo.toml": '# our crate\n[package]\nname = "crab"\nlicense = "Apache-2.0"\n',
      LICENSE: "MIT License\n\nCopyright (c) 2020 Someone\n",
    });
    const stuck = await checkProject(store, "crabby", commented, { fix: true });
    expect(messages(stuck)).toContain("comments");
    expect(await Bun.file(join(commented, "Cargo.toml")).text()).toContain("# our crate");
  });

  test("a missing hook-manager config is a violation dolly refuses to invent", async () => {
    const store = await freshStore();
    await seed(store, { name: "hooky", toolchain: { hooks: "lefthook" } });
    const bare = await repo({ "src/a.ts": "" });
    const report = await checkProject(store, "hooky", bare);
    expect(messages(report)).toContain("lefthook");
    expect(report.violations[0]?.fix).toBeUndefined();

    const equipped = await repo({ "src/a.ts": "", "lefthook.yml": "pre-commit:\n" });
    expect((await checkProject(store, "hooky", equipped)).violations).toEqual([]);
  });

  test("a required {name} entry with no instance names nothing to fix", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "grouped",
      layout: [{ path: "packages/{name}/package.json", required: true }],
    });
    const populated = await repo({ "packages/api/package.json": "{}" });
    expect((await checkProject(store, "grouped", populated)).violations).toEqual([]);

    const empty = await repo({ "README.md": "# hi\n" });
    const report = await checkProject(store, "grouped", empty, { fix: true });
    expect(report.fixed).toEqual([]);
    expect(messages(report)).toContain("create the first instance by hand");
  });

  test("an ignored .env is hygiene, a committed template is fine", async () => {
    const store = await freshStore();
    await seed(store, { name: "envy" });
    const project = await repo({
      ".gitignore": ".env\n",
      ".env": "SECRET=1\n", // ignored: invisible to the walk, no violation
      ".env.example": "SECRET=\n", // committed on purpose
    });
    expect((await checkProject(store, "envy", project)).violations).toEqual([]);
  });

  test("check without a marker or argument needs the caller to name a pattern", async () => {
    expect(await readPatternMarker(await repo({ "README.md": "hi" }))).toBeUndefined();
  });

  test("a fix never truncates a file the inventory cannot see", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "blindspot",
      languages: { programming: ["TypeScript"] },
      layout: [{ path: "src/schema.ts", required: true }],
      toolchain: { taskRunner: "just" },
      commands: { test: "bun test" },
      license: "MIT",
    });
    const project = await repo({
      ".gitignore": "justfile\nLICENSE\n",
      "src/schema.ts": "// @generated by codegen — DO NOT EDIT\nexport const real = 1;\n",
      justfile: "test:\n  ./my-real-harness.sh --everything\n",
      LICENSE: "Proprietary. All rights reserved.\n",
    });

    const report = await checkProject(store, "blindspot", project, { fix: true });
    // Invisible files are reported, never fixed, and never touched.
    expect(report.fixed).toEqual([]);
    expect(messages(report)).toContain("invisible to the pattern's eyes");
    expect(await Bun.file(join(project, "src", "schema.ts")).text()).toContain("real = 1");
    expect(await Bun.file(join(project, "justfile")).text()).toContain("my-real-harness");
    expect(await Bun.file(join(project, "LICENSE")).text()).toContain("Proprietary");
  });

  test("an embedded capture never invents the root manifest it belongs in", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "ruffy",
      toolchain: { configs: { "pyproject.toml#tool.ruff": "toolchain/pyproject.tool.ruff.toml" } },
    });
    await mkdir(join(store.dirOf("ruffy"), "toolchain"), { recursive: true });
    await writeFile(
      join(store.dirOf("ruffy"), "toolchain", "pyproject.tool.ruff.toml"),
      "line-length = 100\n",
    );

    const bare = await repo({ "README.md": "hi\n" });
    const report = await checkProject(store, "ruffy", bare, { fix: true });
    expect(report.fixed).toEqual([]);
    expect(messages(report)).toContain("a manifest is a project decision");
    expect(await Bun.file(join(bare, "pyproject.toml")).exists()).toBe(false);
  });

  test("a broken pattern surfaces as diagnostics, never as a clean report", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "hollow",
      toolchain: { configs: { "biome.json": "toolchain/biome.json" } }, // capture never written
    });
    const project = await repo({ "README.md": "hi\n" });
    const report = await checkProject(store, "hollow", project);
    expect(report.violations).toEqual([]);
    expect(report.diagnostics.join("\n")).toContain("missing from the pattern");
  });

  test("a merge is a minimal edit: the author's shape survives, keys land", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "shapely-config",
      toolchain: { configs: { "tsconfig.json": "toolchain/tsconfig.json" } },
    });
    await mkdir(join(store.dirOf("shapely-config"), "toolchain"), { recursive: true });
    await writeFile(
      join(store.dirOf("shapely-config"), "toolchain", "tsconfig.json"),
      '{ "compilerOptions": { "strict": true } }\n',
    );

    // 4-space, hand-formatted: the captured key lands as one inserted line;
    // nothing else moves.
    const fourSpace = '{\n    "compilerOptions": {\n        "noEmit": true\n    }\n}\n';
    const project = await repo({ "tsconfig.json": fourSpace });
    const report = await checkProject(store, "shapely-config", project, { fix: true });
    expect(report.fixed).toHaveLength(1);
    expect(report.violations).toEqual([]);
    expect(await Bun.file(join(project, "tsconfig.json")).text()).toBe(
      '{\n    "compilerOptions": {\n        "noEmit": true,\n        "strict": true\n    }\n}\n',
    );
  });

  test("a tab-indented manifest no longer blocks the most valuable fix", async () => {
    // The p-limit case from the audit: tabs, strict JSON, and the old
    // byte-identity guard permanently declining every script merge.
    const store = await freshStore();
    await seed(store, {
      name: "tabby",
      languages: { programming: ["TypeScript"] },
      commands: { lint: "biome check ." },
      toolchain: { taskRunner: "npm-scripts", packageManager: "bun" },
      dependencies: { dev: { linter: "@biomejs/biome" } },
    });
    const tabbed = '{\n\t"name": "tabby-app",\n\t"scripts": {\n\t\t"test": "bun test"\n\t}\n}\n';
    const project = await repo({ "package.json": tabbed, "src/index.ts": "export {};\n" });
    const report = await checkProject(store, "tabby", project, { fix: true });
    expect(report.fixed.join("\n")).toContain('script "lint"');
    const after = await Bun.file(join(project, "package.json")).text();
    expect(after).toContain('\t\t"lint": "biome check ."'); // tabs, not dolly's spaces
    expect(after).toContain('"test": "bun test"');
    expect(after).toContain('"name": "tabby-app"');
  });

  test("a colocated, spec-named pattern scaffolds a seed that passes its own check", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "speccy",
      languages: { programming: ["TypeScript"] },
      layout: [{ path: "src/", required: true }],
      toolchain: { testRunner: "bun-test" },
      testing: { placement: "colocated", filePattern: "{stem}.spec.ts" },
    });
    const target = join(await tempDir("dolly-check-target-"), "flock");
    await scaffoldProject(store, "speccy", target);

    expect(await Bun.file(join(target, "src", "index.spec.ts")).text()).toContain("bun:test");
    expect((await checkProject(store, "speccy", target)).violations).toEqual([]);
  });

  test("a separate-placement pattern names its seeded test after the facet's shape", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "shapely",
      languages: { programming: ["TypeScript"] },
      layout: [
        { path: "src/", required: true },
        { path: "tests/", required: true },
      ],
      toolchain: { testRunner: "vitest" },
      testing: { placement: "separate", filePattern: "{stem}.spec.ts" },
    });
    const target = join(await tempDir("dolly-check-target-"), "herd");
    await scaffoldProject(store, "shapely", target);

    expect(await Bun.file(join(target, "tests", "index.spec.ts")).exists()).toBe(true);
    expect(await Bun.file(join(target, "src", "index.spec.ts")).exists()).toBe(false);
    expect((await checkProject(store, "shapely", target)).violations).toEqual([]);
  });

  test("a captured hook config gets a create-fix; the hooks rule stands down", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "hooky",
      toolchain: {
        hooks: "pre-commit",
        configs: { ".pre-commit-config.yaml": "toolchain/.pre-commit-config.yaml" },
      },
    });
    await mkdir(join(store.dirOf("hooky"), "toolchain"), { recursive: true });
    const captured = "repos:\n  - repo: local\n";
    await writeFile(join(store.dirOf("hooky"), "toolchain", ".pre-commit-config.yaml"), captured);

    const project = await repo({ "main.py": "" });
    const found = await checkProject(store, "hooky", project);
    // One violation, the config rule's, carrying a real fix, not the hooks
    // rule's set-it-up-yourself shrug on top.
    expect(found.violations.map((v) => v.rule)).toEqual(["config"]);
    expect(found.violations[0]?.fix?.kind).toBe("create");

    const fixed = await checkProject(store, "hooky", project, { fix: true });
    expect(fixed.violations).toEqual([]);
    expect(await Bun.file(join(project, ".pre-commit-config.yaml")).text()).toBe(captured);
  });

  test("a scaffolded {name} instance takes the pattern's own case", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "snakes",
      naming: { files: "snake_case", directories: "snake_case" },
      languages: { programming: ["Python"] },
      layout: [
        { path: "packages/", required: true },
        { path: "packages/{name}/", required: true },
        { path: "packages/{name}/{name}.py", required: true },
      ],
    });
    // The target directory is kebab-flavored; the pattern is snake_case.
    const target = join(await tempDir("dolly-check-target-"), "from-typer");
    await scaffoldProject(store, "snakes", target);
    expect(await Bun.file(join(target, "packages/from_typer/from_typer.py")).exists()).toBe(true);
    expect((await checkProject(store, "snakes", target)).violations).toEqual([]);
  });

  test("naming judges code only; anything else needs an explicit extensions entry", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "codebound",
      languages: { programming: ["TypeScript"] },
      naming: { files: "kebab-case" },
    });
    const project = await repo({
      "src/BadFile.ts": "export {};\n",
      "docs/BadDoc.md": "# doc\n",
      "img/BadShot.png": "bytes",
    });
    const report = await checkProject(store, "codebound", project);
    expect(report.violations.map((v) => v.path)).toEqual(["src/BadFile.ts"]);

    // The author's naming.extensions entry is the opt-in for non-code.
    await seed(store, {
      name: "optedin",
      languages: { programming: ["TypeScript"] },
      naming: { files: "kebab-case", extensions: { ".md": "kebab-case" } },
    });
    const opted = await checkProject(store, "optedin", project);
    expect(opted.violations.map((v) => v.path).sort()).toEqual([
      "docs/BadDoc.md",
      "src/BadFile.ts",
    ]);
  });

  test("the marker's rules turn a rule off (counted) or down to a warning", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "strict",
      naming: { files: "snake_case" },
      layout: [{ path: "docs/", required: true }],
    });
    const project = await repo({
      ".dolly": "pattern: strict\nrules:\n  naming: off\n  layout: warn\n",
      "src/BadName.py": "",
    });
    const report = await checkProject(store, "strict", project);
    expect(report.violations.map((v) => `${v.rule} ${v.path} ${v.severity ?? "error"}`)).toEqual([
      "layout docs/ warning",
    ]);
    expect(report.ignored).toBe(1);
    const bad = await repo({ ".dolly": "pattern: strict\nrules:\n  naming: loud\n" });
    expect((await checkProject(store, "strict", bad)).diagnostics.join("\n")).toContain(
      "not a valid marker",
    );
  });

  test("a vendored pattern resolves from the project itself, store or no store", async () => {
    const store = await freshStore();
    await seed(store, { name: "tidy", layout: [{ path: "docs/", required: true }] });
    const project = await repo({ "docs/index.md": "# docs\n" });
    const { vendored } = await linkProject(project, "tidy", { vendorFrom: store });
    expect(vendored).toBe("dolly/tidy");
    expect(await Bun.file(join(project, "dolly/tidy/pattern.md")).exists()).toBe(true);
    expect(await readFile(join(project, ".dolly"), "utf8")).toBe("pattern: tidy\nsource: dolly\n");
    // A teammate's machine: nothing in the store, and check still works.
    const ref = (await resolvePattern(await freshStore(), project)) as PatternRef;
    expect(ref.name).toBe("tidy");
    expect((await checkProject(ref.store, ref.name, project)).violations).toEqual([]);
    // An explicit name still reads the machine's store.
    expect((await resolvePattern(store, project, "tidy"))?.store).toBe(store);
    // Linking again without vendoring makes the store the home again.
    await linkProject(project, "tidy");
    expect(await readFile(join(project, ".dolly"), "utf8")).toBe("pattern: tidy\n");
  });

  test("a bundle URL as the source is fetched into a temporary store for the run", async () => {
    const store = await freshStore();
    await seed(store, { name: "tidy", layout: [{ path: "docs/", required: true }] });
    const bundle = await exportBundle(
      store,
      "tidy",
      join(await tempDir("dolly-bundle-"), "tidy.dolly"),
    );
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(Bun.file(bundle)),
    });
    try {
      const url = `http://127.0.0.1:${server.port}/tidy.dolly`;
      const project = await repo({ ".dolly": `pattern: tidy\nsource: ${url}\n`, "docs/a.md": "" });
      const ref = (await resolvePattern(await freshStore(), project)) as PatternRef;
      expect(ref.name).toBe("tidy");
      expect(ref.store).not.toBe(store);
      expect((await checkProject(ref.store, ref.name, project)).violations).toEqual([]);
      const wrong = await repo({ ".dolly": `pattern: other\nsource: ${url}\n` });
      await expect(resolvePattern(await freshStore(), wrong)).rejects.toThrow('holds "tidy"');
    } finally {
      server.stop(true);
    }
  });

  test("ignorePaths appends once each and refuses a path outside the project", async () => {
    const project = await repo({ ".dolly": "pattern: strict\nignore:\n  - legacy/\n" });
    const marker = await ignorePaths(project, ["legacy/", "shell/*.fish"]);
    expect(marker.ignore).toEqual(["legacy/", "shell/*.fish"]);
    expect(await readFile(join(project, ".dolly"), "utf8")).toBe(
      "pattern: strict\nignore:\n  - legacy/\n  - shell/*.fish\n",
    );
    await expect(ignorePaths(project, ["../out"])).rejects.toThrow("not a relative path");
    await expect(ignorePaths(await repo({}), ["x"])).rejects.toThrow("No .dolly marker");
  });

  test("the marker's ignore list sets violations aside: counted, never reported, never fixed", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "strict",
      naming: { files: "snake_case" },
      layout: [
        { path: "docs/", required: true },
        { path: "CHANGELOG.md", required: true },
      ],
    });
    const project = await repo({
      ".dolly": "pattern: strict\nignore:\n  - shell/*.fish\n  - legacy/\n  - CHANGELOG.md\n",
      "shell/key-bindings.fish": "",
      "shell/key-bindings.zsh": "",
      "legacy/OldThing.py": "",
      "legacy/deep/AnotherOne.py": "",
    });
    const report = await checkProject(store, "strict", project);
    expect(report.violations.map((v) => `${v.rule} ${v.path}`)).toEqual([
      "layout docs/",
      "naming shell/key-bindings.zsh",
    ]);
    expect(report.ignored).toBe(4);
    // An ignored fixable violation is not fixed either.
    await checkProject(store, "strict", project, { fix: true });
    expect(await Bun.file(join(project, "CHANGELOG.md")).exists()).toBe(false);
    expect(await Bun.file(join(project, "docs/.gitkeep")).exists()).toBe(true);
  });

  test("a marker that does not parse is a diagnostic, and nothing is ignored", async () => {
    const store = await freshStore();
    await seed(store, { name: "strict", naming: { files: "snake_case" } });
    const project = await repo({
      ".dolly": "pattern: strict\nignore:\n  - ../outside\n",
      "Bad-Name.py": "",
    });
    const report = await checkProject(store, "strict", project);
    expect(report.violations.map((v) => v.path)).toEqual(["Bad-Name.py"]);
    expect(report.ignored).toBe(0);
    expect(report.diagnostics[0]).toContain(".dolly is not a valid marker");
  });

  test("two creates aimed at one path: captured bytes beat the layout stub, reported once", async () => {
    // The layout rule used to want .editorconfig to exist (empty stub) while
    // the config rule wanted it to hold the captured bytes. Unreconciled,
    // whichever ran first won: a 0-byte file reported as two successful
    // fixes, with a violation no later --fix could ever clear. The layout
    // rule now stands down for captured files, and creates still reconcile.
    const store = await freshStore();
    await seed(store, {
      name: "cfg",
      layout: [{ path: ".editorconfig", required: true }],
      toolchain: { configs: { ".editorconfig": "toolchain/editorconfig" } },
    });
    await mkdir(join(store.dirOf("cfg"), "toolchain"), { recursive: true });
    await writeFile(join(store.dirOf("cfg"), "toolchain", "editorconfig"), "root = true\n");
    const project = await repo({ "src/index.ts": "export {};\n" });

    const report = await checkProject(store, "cfg", project, { fix: true });
    expect(await Bun.file(join(project, ".editorconfig")).text()).toBe("root = true\n");
    expect(report.fixed.filter((line) => line.startsWith(".editorconfig")).length).toBe(1);
    expect(report.violations).toEqual([]);
  });
});
