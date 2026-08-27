import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assistedFit } from "../src/ai/placement";
import { assistedFitApply } from "../src/ai/translation";
import { fitProject, type TranslateStep } from "../src/apply/fit";
import { checkProject } from "../src/check/check";
import { codeLanguagesOf, primaryExtensionOf } from "../src/extract/languages";
import type { PatternStore } from "../src/store";
import { cleanupTempRoots, freshStore, repo, seed } from "./support";

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

/** A small Python project under git, and a TypeScript pattern with commands that judge it. */
async function pythonProject(
  commands: Record<string, string>,
): Promise<{ store: PatternStore; root: string }> {
  const store = await freshStore();
  await seed(store, {
    name: "ts-service",
    languages: { programming: ["TypeScript"] },
    commands,
  });
  const root = await repo({
    "src/greet.py": 'def greet(name):\n    return f"hi {name}"\n',
    "src/main.py": "from greet import greet\nprint(greet('dolly'))\n",
    "README.md": "# greeter\n",
    "data.json": "{}\n",
  });
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "fit@test");
  await git(root, "config", "user.name", "fit test");
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", "before fit");
  return { store, root };
}

const translations = (plan: { steps: { kind: string }[] }) =>
  plan.steps.filter((s): s is TranslateStep => s.kind === "translate");

describe("the languages rule", () => {
  test("judges code by extension, and never data or docs", () => {
    expect(codeLanguagesOf("src/a.py")).toEqual(["Python"]);
    expect(codeLanguagesOf("README.md")).toEqual([]); // Markdown before GCC machine descriptions
    expect(codeLanguagesOf("data.json")).toEqual([]);
    expect(primaryExtensionOf("TypeScript")).toBe(".ts");
  });

  test("reports every off-pattern code file, never fixable, and nothing without a languages facet", async () => {
    const { store, root } = await pythonProject({});
    const report = await checkProject(store, "ts-service", root);
    const off = report.violations.filter((v) => v.rule === "languages");
    expect(off.map((v) => v.path)).toEqual(["src/greet.py", "src/main.py"]);
    expect(off[0]?.message).toBe("written in Python; the pattern sanctions TypeScript");
    expect(off.every((v) => v.fix === undefined)).toBe(true);

    await seed(store, { name: "any" });
    expect((await checkProject(store, "any", root)).violations).toEqual([]);
  });
});

describe("translation", () => {
  const realFetch = globalThis.fetch;
  let outerHome: string | undefined;
  let outerKey: string | undefined;
  let calls: string[];

  beforeEach(async () => {
    outerHome = process.env.DOLLY_HOME;
    outerKey = process.env.ANTHROPIC_API_KEY;
    process.env.DOLLY_HOME = await mkdtemp(join(tmpdir(), "dolly-translate-"));
    calls = [];
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (outerHome === undefined) delete process.env.DOLLY_HOME;
    else process.env.DOLLY_HOME = outerHome;
    if (outerKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = outerKey;
  });

  async function turnOn(): Promise<void> {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    await writeFile(
      join(process.env.DOLLY_HOME as string, "ai.json"),
      JSON.stringify({ provider: "anthropic" }),
    );
  }

  /** The model as a function of the file it is asked to translate. */
  function stubModel(answer: (prompt: string) => string): void {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      const prompt = body.messages[0]?.content ?? "";
      calls.push(prompt);
      return new Response(JSON.stringify({ content: [{ type: "text", text: answer(prompt) }] }), {
        status: 200,
      });
    }) as typeof fetch;
  }

  const wellFormed = (prompt: string) =>
    prompt.includes("src/greet.py")
      ? "```ts\nexport function greet(name: string): string {\n  return 'hi ' + name;\n}\n```"
      : 'Here you go:\n```ts\nimport { greet } from "./greet";\nconsole.log(greet("dolly"));\n```\n';

  test("the dry run declines with AI off and plans with it on, saying what would go to the model", async () => {
    const { store, root } = await pythonProject({});
    const off = await assistedFit(store, "ts-service", root);
    expect(translations(off)).toEqual([]);
    expect(off.declined.map((d) => d.message)).toContain(
      "written in Python; the pattern sanctions TypeScript: translation needs the AI layer; `dolly ai connect` turns it on",
    );

    await turnOn();
    const on = await assistedFit(store, "ts-service", root);
    expect(translations(on).map((s) => `${s.from} → ${s.to} (${s.language})`)).toEqual([
      "src/greet.py → src/greet.ts (TypeScript)",
      "src/main.py → src/main.ts (TypeScript)",
    ]);
    expect(translations(on)[0]?.bytes).toBeGreaterThan(0);
    expect(calls.length).toBe(0); // planning never calls the model
  });

  test("ADR-0004's bounds: at most 25 files per apply, 64 KiB per file", async () => {
    const store = await freshStore();
    await seed(store, { name: "ts-service", languages: { programming: ["TypeScript"] } });
    const files: Record<string, string> = { "src/big.py": `# ${"x".repeat(65 * 1024)}\n` };
    for (let i = 0; i < 26; i++) files[`src/m${String(i).padStart(2, "0")}.py`] = "x = 1\n";
    const root = await repo(files);
    await turnOn();
    const plan = await assistedFit(store, "ts-service", root);
    expect(translations(plan).length).toBe(25);
    const reasons = plan.declined.map((d) => d.message);
    expect(
      reasons.some((m) => m.includes("65 KiB is over the 64 KiB one translation allows")),
    ).toBe(true);
    expect(reasons.some((m) => m.includes("over the 25 translations one apply allows"))).toBe(true);
  });

  test("two sources with one stem cannot both become the same file", async () => {
    const { store, root } = await pythonProject({});
    await writeFile(join(root, "src/greet.sh"), "echo hi\n");
    await turnOn();
    const plan = await assistedFit(store, "ts-service", root);
    expect(translations(plan).map((s) => s.to)).toEqual(["src/greet.ts", "src/main.ts"]);
    expect(plan.declined.map((d) => d.message)).toContain(
      "written in Shell; the pattern sanctions TypeScript, but src/greet.ts already exists (or two translations collide there)",
    );
  });

  test("apply writes, verifies with the pattern's commands, removes the sources, and commits", async () => {
    const { store, root } = await pythonProject({ typecheck: "true", test: "true" });
    await turnOn();
    stubModel(wellFormed);
    const result = await assistedFitApply(store, "ts-service", root);
    expect(result.failures).toEqual([]);
    expect(result.committed).toBe(true);
    expect(result.verified).toEqual(["typecheck passed: true", "test passed: true"]);
    expect(await readFile(join(root, "src/greet.ts"), "utf8")).toContain("export function greet");
    expect(await Bun.file(join(root, "src/greet.py")).exists()).toBe(false);
    // The second call saw the first translation as house style, and the whole mapping.
    expect(calls[1]).toContain("--- src/greet.ts");
    expect(calls[1]).toContain("src/main.py becomes src/main.ts");
    const after = await checkProject(store, "ts-service", root);
    expect(after.violations.filter((v) => v.rule === "languages")).toEqual([]);
    expect(translations(await fitProject(store, "ts-service", root, { translate: true }))).toEqual(
      [],
    );
    // The checkpoint branch holds the original tree.
    expect(await git(root, "show", `${result.checkpoint}:src/greet.py`)).toContain("def greet");
  });

  test("a reply without one code block fails its step: nothing removed, nothing committed", async () => {
    const { store, root } = await pythonProject({ typecheck: "true" });
    await turnOn();
    stubModel((prompt) =>
      prompt.includes("src/main.py") ? "I would rather not." : wellFormed(prompt),
    );
    const result = await assistedFitApply(store, "ts-service", root);
    expect(result.committed).toBe(false);
    expect(result.failures.join("\n")).toContain(
      "translate src/main.py → src/main.ts: the model did not answer with one fenced code block",
    );
    expect(await Bun.file(join(root, "src/main.py")).exists()).toBe(true);
    expect(await Bun.file(join(root, "src/greet.py")).exists()).toBe(true);
    expect(result.verified).toEqual([]); // never reached
  });

  test("a failing verification keeps every source, commits nothing, and reports the output", async () => {
    const { store, root } = await pythonProject({
      typecheck: "echo 'src/main.ts: type error' >&2; exit 2",
    });
    await turnOn();
    stubModel(wellFormed);
    const result = await assistedFitApply(store, "ts-service", root);
    expect(result.committed).toBe(false);
    expect(result.verified.join("\n")).toContain("typecheck failed");
    expect(result.verified.join("\n")).toContain("src/main.ts: type error");
    expect(result.verified.join("\n")).toContain("no test command in the pattern");
    expect(result.failures).toContain(
      "verification failed, so the sources stay and nothing is committed",
    );
    expect(await Bun.file(join(root, "src/greet.py")).exists()).toBe(true);
    expect(await Bun.file(join(root, "src/greet.ts")).exists()).toBe(true); // left for inspection
  });
});
