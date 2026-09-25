import { afterAll, describe, expect, test } from "bun:test";
import { chmod, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  applyFitPlan,
  FitGitError,
  type FitStep,
  fitApply,
  fitProject,
  type MoveStep,
} from "../src/apply/fit";
import { rewriteSpecifiers } from "../src/apply/imports";
import { checkProject } from "../src/check/check";
import { renderStem } from "../src/extract/naming";
import { cleanupTempRoots, freshStore, repo, seed, tempDir } from "./support";

afterAll(cleanupTempRoots);

async function git(root: string, ...args: string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${err}`);
  return out;
}

async function gitRepo(files: Record<string, string>): Promise<string> {
  const root = await repo(files);
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "fit@test");
  await git(root, "config", "user.name", "fit test");
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", "before fit");
  return root;
}

const moves = (plan: { steps: { kind: string }[] }) =>
  plan.steps.filter((s): s is MoveStep => s.kind === "move");

describe("renderStem", () => {
  test("splits humps, separators, and acronym runs", () => {
    expect(renderStem("MyHTTPServer", "kebab-case")).toBe("my-http-server");
    expect(renderStem("user_profile", "PascalCase")).toBe("UserProfile");
    expect(renderStem("my-thing", "snake_case")).toBe("my_thing");
    expect(renderStem("parseJSON", "camelCase")).toBe("parseJson");
  });
});

describe("rewriteSpecifiers", () => {
  test("one pass: a rewrite's result never re-matches another rewrite's source", () => {
    const text = 'import a from "../util";\nimport b from "./util";\n';
    const out = rewriteSpecifiers(text, [
      { file: "x", from: "../util", to: "./util", target: "util.ts" },
      { file: "x", from: "./util", to: "./src/util", target: "src/util.ts" },
    ]);
    expect(out).toBe('import a from "./util";\nimport b from "./src/util";\n');
  });
});

describe("fitProject", () => {
  test("a naming rename carries every import style along", async () => {
    const store = await freshStore();
    await seed(store, { name: "kebab", naming: { files: "kebab-case" } });
    const root = await repo({
      "src/MyHelper.ts": "export const helper = 1;\n",
      "src/index.ts": 'export { helper } from "./MyHelper";\n',
      "src/deep/user.ts": 'import { helper } from "../MyHelper.js";\nexport const u = helper;\n',
    });
    const plan = await fitProject(store, "kebab", root);
    expect(moves(plan)).toHaveLength(1);
    const move = moves(plan)[0] as MoveStep;
    expect(move.from).toBe("src/MyHelper.ts");
    expect(move.to).toBe("src/my-helper.ts");
    expect(move.rule).toBe("naming");
    const byFile = Object.fromEntries(move.rewrites.map((r) => [r.file, r]));
    // The bare specifier stays bare; the nodenext .js specifier keeps its .js.
    expect(byFile["src/index.ts"]?.to).toBe("./my-helper");
    expect(byFile["src/deep/user.ts"]?.to).toBe("../my-helper.js");
  });

  test("a separate test moves next to its one source, taking the pattern's name shape", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "colo",
      testing: { placement: "colocated", filePattern: "{stem}.test.ts" },
    });
    const root = await repo({
      "src/user.ts": "export const user = 1;\n",
      "tests/user.spec.ts": 'import { user } from "../src/user";\nexport const t = user;\n',
    });
    const plan = await fitProject(store, "colo", root);
    expect(moves(plan)).toHaveLength(1);
    const move = moves(plan)[0] as MoveStep;
    expect(move.to).toBe("src/user.test.ts");
    expect(move.rule).toBe("testing");
    // The moved file's own import re-bases to its new home.
    expect(move.rewrites).toEqual([
      { file: "tests/user.spec.ts", from: "../src/user", to: "./user", target: "src/user.ts" },
    ]);
  });

  test("a colocated test moves under the one existing test root, src/ stripped", async () => {
    const store = await freshStore();
    await seed(store, { name: "sep", testing: { placement: "separate" } });
    const root = await repo({
      "src/thing.ts": "export const thing = 1;\n",
      "src/thing.test.ts": 'import { thing } from "./thing";\nexport const t = thing;\n',
      "tests/other.test.ts": "export {};\n",
    });
    const plan = await fitProject(store, "sep", root);
    const move = moves(plan).find((m) => m.from === "src/thing.test.ts");
    expect(move?.to).toBe("tests/thing.test.ts");
    expect(move?.rewrites[0]?.to).toBe("../src/thing");
  });

  test("an ambiguous destination declines with its reason instead of guessing", async () => {
    const store = await freshStore();
    await seed(store, { name: "colo", testing: { placement: "colocated" } });
    const root = await repo({
      "src/a/user.ts": "export const a = 1;\n",
      "src/b/user.ts": "export const b = 1;\n",
      "tests/user.test.ts": "export {};\n",
    });
    const plan = await fitProject(store, "colo", root);
    expect(moves(plan)).toHaveLength(0);
    expect(plan.declined.map((d) => d.message).join("\n")).toContain("2 files named user.ts");
    // The decline enumerates the destinations it refused to pick between;
    // that list is the whole opening the AI layer gets.
    const ambiguous = plan.declined.find((d) => d.candidates);
    expect(ambiguous?.candidates).toEqual(["src/a/user.test.ts", "src/b/user.test.ts"]);
  });

  test("several test roots decline with their candidate destinations enumerated", async () => {
    const store = await freshStore();
    await seed(store, { name: "sep", testing: { placement: "separate" } });
    const root = await repo({
      "src/thing.ts": "export const thing = 1;\n",
      "src/thing.test.ts": 'import { thing } from "./thing";\nexport const t = thing;\n',
      "tests/keep.test.ts": "export {};\n",
      "test/also.test.ts": "export {};\n",
    });
    const plan = await fitProject(store, "sep", root);
    const item = plan.declined.find((d) => d.message.includes("several test roots"));
    expect(item?.candidates).toEqual(["test/thing.test.ts", "tests/thing.test.ts"]);
  });

  test("a rename whose target already exists declines instead of clobbering", async () => {
    const store = await freshStore();
    await seed(store, { name: "kebab", naming: { files: "kebab-case" } });
    const root = await repo({
      "src/MyHelper.ts": "export const a = 1;\n",
      "src/my-helper.ts": "export const b = 1;\n",
    });
    const plan = await fitProject(store, "kebab", root);
    expect(moves(plan)).toHaveLength(0);
    expect(plan.declined.map((d) => d.message).join("\n")).toContain("already exists");
  });

  test("a move outside the import ledger's languages declines: no accounting, no move", async () => {
    const store = await freshStore();
    await seed(store, { name: "snakes", naming: { files: "snake_case" } });
    const root = await repo({
      "pkg/__init__.py": "from .coreParams import x\n",
      "pkg/coreParams.py": "x = 1\n",
    });
    const plan = await fitProject(store, "snakes", root);
    expect(moves(plan)).toHaveLength(0);
    expect(plan.declined.map((d) => d.message).join("\n")).toContain(
      "cannot yet account for references to .py files",
    );
  });

  test("blind importer types in the tree make every move unaccountable", async () => {
    const store = await freshStore();
    await seed(store, { name: "kebab", naming: { files: "kebab-case" } });
    const root = await repo({
      "src/MyHelper.ts": "export const helper = 1;\n",
      "src/App.vue": "<script setup>import { helper } from './MyHelper';</script>\n",
    });
    const plan = await fitProject(store, "kebab", root);
    expect(moves(plan)).toHaveLength(0);
    expect(plan.declined.map((d) => d.message).join("\n")).toContain(
      ".vue files whose imports dolly cannot yet read",
    );
  });

  test("a test the pattern's own layout demands in place is a contradiction, not a move", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "contradictory",
      testing: { placement: "separate" },
      layout: [{ path: "examples/{name}/demo.test.ts", required: true }],
    });
    const root = await repo({
      "examples/basic/demo.test.ts": "export {};\n",
      "tests/other.test.ts": "export {};\n",
    });
    const plan = await fitProject(store, "contradictory", root);
    // The file is where its layout entry wants it: no move, no decline, and the
    // contradiction is the pattern's, filed as a diagnostic.
    expect(moves(plan)).toHaveLength(0);
    expect(plan.declined).toEqual([]);
    expect(plan.diagnostics.join("\n")).toContain('layout demands "examples/{name}/demo.test.ts"');
  });

  test("two rules wanting one file: the second waits for the first's move, or is the author's", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "both",
      naming: { files: "kebab-case" },
      testing: { placement: "separate" },
    });
    const waits = await fitProject(
      store,
      "both",
      await repo({ "src/MyThing.test.ts": "export {};\n", "tests/other.test.ts": "export {};\n" }),
    );
    expect(moves(waits).map((m) => m.to)).toEqual(["src/my-thing.test.ts"]);
    expect(waits.declined.map((d) => d.message).join("\n")).toContain(
      "naming moves this file in the same plan, so apply it and run fit again for testing's move",
    );
    // With a .vue importer in the tree every move is declined, and the second rule's says so.
    const declined = await fitProject(
      store,
      "both",
      await repo({
        "src/MyThing.test.ts": "export {};\n",
        "tests/other.test.ts": "export {};\n",
        "src/App.vue": "<template />\n",
      }),
    );
    expect(moves(declined)).toHaveLength(0);
    expect(declined.declined.map((d) => d.message).join("\n")).toContain(
      "naming's move of this file was declined too, so this one is yours to make",
    );
  });

  test("a rename keeps the affixes check never judged", async () => {
    const store = await freshStore();
    await seed(store, { name: "kebab", naming: { files: "kebab-case" } });
    const root = await repo({ "src/MyThing_test.ts": "export {};\n" });
    const plan = await fitProject(store, "kebab", root);
    // normalizeStem judged "MyThing"; the _test suffix survives the rename,
    // so the file stays a test to every tool that greps for one.
    expect((moves(plan)[0] as MoveStep).to).toBe("src/my-thing_test.ts");
  });

  test("a .js specifier resolving a .tsx file keeps its .js on rewrite", async () => {
    const store = await freshStore();
    await seed(store, { name: "kebab", naming: { files: "kebab-case" } });
    const root = await repo({
      "src/MyButton.tsx": "export const b = 1;\n",
      "src/app.ts": 'export { b } from "./MyButton.js";\n',
    });
    const plan = await fitProject(store, "kebab", root);
    expect((moves(plan)[0] as MoveStep).rewrites[0]?.to).toBe("./my-button.js");
  });

  test("a move may not land on a path the plan's own fix step creates", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "clash",
      naming: { files: "kebab-case" },
      layout: [{ path: "src/my-helper.ts", required: true }],
    });
    const root = await repo({ "src/MyHelper.ts": "export const a = 1;\n" });
    const plan = await fitProject(store, "clash", root);
    // Layout plans a create at src/my-helper.ts; the rename may not land there.
    expect(plan.steps.some((s) => s.kind === "fix" && s.path === "src/my-helper.ts")).toBe(true);
    expect(moves(plan)).toHaveLength(0);
    expect(plan.declined.map((d) => d.message).join("\n")).toContain("two steps collide");
  });

  test("a destination the inventory cannot see (gitignored) still collides", async () => {
    const store = await freshStore();
    await seed(store, { name: "kebab", naming: { files: "kebab-case" } });
    const root = await repo({
      "src/MyConfig.ts": "export const a = 1;\n",
      "src/my-config.ts": "generated\n",
      ".gitignore": "src/my-config.ts\n",
    });
    const plan = await fitProject(store, "kebab", root);
    expect(moves(plan)).toHaveLength(0);
    expect(plan.declined.map((d) => d.message).join("\n")).toContain("already exists");
  });

  test("a file move into a directory the same plan renames away waits", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "twist",
      naming: { files: "kebab-case", directories: "PascalCase" },
    });
    const root = await repo({
      "App/user.ts": "export const u = 1;\n",
      "handlers/MyThing.ts": "export const t = 1;\n",
    });
    const plan = await fitProject(store, "twist", root);
    // The dir rename handlers/ → Handlers/ proceeds; the file rename inside it waits.
    expect(moves(plan).map((m) => m.from)).toEqual(["handlers/"]);
    expect(plan.declined.map((d) => d.message).join("\n")).toContain(
      "being renamed in this same plan",
    );
  });

  test("a monorepo's nearest test root beats any top-level rule", async () => {
    const store = await freshStore();
    await seed(store, { name: "mono", testing: { placement: "separate" } });
    const root = await repo({
      "packages/api/src/user.ts": "export const u = 1;\n",
      "packages/api/src/user.test.ts": 'import { u } from "./user";\nexport const t = u;\n',
      "packages/api/tests/setup.test.ts": "export {};\n",
    });
    const plan = await fitProject(store, "mono", root);
    expect((moves(plan)[0] as MoveStep).to).toBe("packages/api/tests/user.test.ts");
  });

  test("every fix step carries the patch it would make, as the file stands", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "tidy",
      languages: { programming: ["TypeScript"] },
      commands: { test: "bun test" },
      layout: [{ path: "docs/", required: true }],
    });
    const root = await repo({
      "package.json": '{\n  "name": "x",\n  "scripts": {\n    "lint": "biome check ."\n  }\n}\n',
      ".env": "SECRET=1\n",
      ".dolly": "pattern: tidy\n",
    });
    const plan = await fitProject(store, "tidy", root);
    const fixes = plan.steps.filter(
      (s): s is Extract<FitStep, { kind: "fix" }> => s.kind === "fix",
    );
    const byPath = Object.fromEntries(fixes.map((step) => [step.path, step.preview]));
    // A merge shows the one key it adds, inside the author's own shape.
    expect(byPath["package.json"]).toContain('+     "test": "bun test"');
    expect(byPath["package.json"]).toContain('  "scripts": {');
    // An append shows the line it adds; a directory create has nothing to show.
    expect(byPath[".env"]).toBe("+ .env");
    expect(byPath["docs/"]).toBe("");
    // The preview reads the file as it stands: after apply, the same plan is empty.
    await checkProject(store, "tidy", root, { fix: true });
    expect((await fitProject(store, "tidy", root)).steps).toEqual([]);
  });

  test("a project without a marker gets one as a create step; a marker there is left alone", async () => {
    const store = await freshStore();
    await seed(store, { name: "kebab", naming: { files: "kebab-case" } });
    const root = await repo({ "src/my-helper.ts": "export {};\n" });
    const plan = await fitProject(store, "kebab", root);
    expect(plan.steps).toEqual([
      {
        kind: "fix",
        path: ".dolly",
        reason: "links the project to its pattern, so check and fit resolve it without a name",
        plan: { kind: "create", path: ".dolly", contents: "pattern: kebab\n" },
        preview: "+ pattern: kebab",
      },
    ]);
    await writeFile(join(root, ".dolly"), "pattern: other\n");
    expect((await fitProject(store, "kebab", root)).steps).toEqual([]);
  });

  test("check's fixable violations ride along as fix steps", async () => {
    const store = await freshStore();
    await seed(store, { name: "lic", license: "MIT" });
    const root = await repo({ "src/index.ts": "export {};\n" });
    const plan = await fitProject(store, "lic", root);
    const fix = plan.steps.find((s) => s.kind === "fix");
    expect(fix?.kind === "fix" && fix.plan.kind).toBe("create");
    expect(fix?.path).toBe("LICENSE");
  });
});

describe("fitApply", () => {
  test("refuses a dirty tree, and a tree with no git at all", async () => {
    const store = await freshStore();
    await seed(store, { name: "kebab", naming: { files: "kebab-case" } });
    const bare = await repo({ "src/MyHelper.ts": "export {};\n" });
    expect(fitApply(store, "kebab", bare)).rejects.toThrow(FitGitError);
    const dirty = await gitRepo({ "src/MyHelper.ts": "export {};\n" });
    await writeFile(join(dirty, "scratch.txt"), "uncommitted\n");
    expect(fitApply(store, "kebab", dirty)).rejects.toThrow("dirty");
  });

  // A read-only directory is how the rename is made to fail, and Windows
  // permissions do not refuse a rename that way, so the case is POSIX-only.
  test.skipIf(process.platform === "win32")("a half-applied tree is never committed", async () => {
    const store = await freshStore();
    await seed(store, { name: "kebab", naming: { files: "kebab-case" } });
    // One step that will land (the env append) and one that will fail (the
    // rename, into a read-only directory): a partial apply, the worst case.
    const root = await gitRepo({
      "src/MyHelper.ts": "export const h = 1;\n",
      ".env": "SECRET=1\n",
      ".gitignore": "node_modules/\n",
    });
    const before = (await git(root, "rev-parse", "HEAD")).trim();
    await chmod(join(root, "src"), 0o555);
    try {
      const result = await fitApply(store, "kebab", root);
      expect(result.applied.length).toBeGreaterThan(0);
      expect(result.failures.join("\n")).toContain("not committed");
      expect(result.committed).toBe(false);
      expect((await git(root, "rev-parse", "HEAD")).trim()).toBe(before);
    } finally {
      await chmod(join(root, "src"), 0o755);
    }
  });

  test("the acceptance loop: apply → clean check → plans nothing → checkpoint restores", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "shape",
      naming: { files: "kebab-case" },
      testing: { placement: "colocated", filePattern: "{stem}.test.ts" },
      license: "MIT",
    });
    const root = await gitRepo({
      "src/MyHelper.ts": "export const helper = 1;\n",
      "src/index.ts": 'export { helper } from "./MyHelper";\n',
      "src/widget.ts": "export const widget = 2;\n",
      "tests/widget.spec.ts": 'import { widget } from "../src/widget";\nexport const t = widget;\n',
    });

    const result = await fitApply(store, "shape", root);
    expect(result.failures).toEqual([]);
    expect(result.checkpoint).toBe("dolly/fit-shape-1");

    // The tree now is what the pattern says.
    expect(await Bun.file(join(root, "src/my-helper.ts")).exists()).toBe(true);
    expect(await Bun.file(join(root, "src/index.ts")).text()).toContain('"./my-helper"');
    expect(await Bun.file(join(root, "src/widget.test.ts")).text()).toContain('"./widget"');
    expect(await Bun.file(join(root, "LICENSE")).exists()).toBe(true);

    const after = await checkProject(store, "shape", root);
    expect(after.violations).toEqual([]);
    const again = await fitProject(store, "shape", root);
    expect(again.steps).toEqual([]);

    // Fully revertible: the checkpoint branch holds the pre-fit tree.
    await git(root, "switch", "-q", result.checkpoint as string);
    expect(await Bun.file(join(root, "src/MyHelper.ts")).exists()).toBe(true);
    expect(await Bun.file(join(root, "src/my-helper.ts")).exists()).toBe(false);
    expect(await Bun.file(join(root, "LICENSE")).exists()).toBe(false);
  });
});

describe("what a plan may not reach", () => {
  test.skipIf(process.platform === "win32")("a move never lands through a symlink", async () => {
    const outside = await tempDir("dolly-outside-");
    const root = await repo({ "user.test.ts": "export {};\n", "user.ts": "export {};\n" });
    await symlink(outside, join(root, "src"));
    const plan = {
      pattern: "colo",
      steps: [
        {
          kind: "move",
          rule: "testing",
          from: "user.test.ts",
          to: "src/user.test.ts",
          reason: "",
          rewrites: [],
        },
      ] as FitStep[],
      declined: [],
      diagnostics: [],
    };
    const result = await applyFitPlan(root, plan);
    expect(result.applied).toEqual([]);
    expect(result.failures.join("\n")).toContain("symlink");
    expect(await readdir(outside)).toEqual([]);
    expect(await Bun.file(join(root, "user.test.ts")).exists()).toBe(true);
  });
});
