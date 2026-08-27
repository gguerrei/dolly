import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draftConventions } from "../src/ai/conventions";
import { extractPattern, saveExtractedPattern } from "../src/extract/extract";
import { unifiedDiff } from "../src/learn/diff";
import { learnDrift, type Proposal } from "../src/learn/drift";
import { draftDocument, renderProposal, saveLearned } from "../src/learn/learn";
import type { PatternStore } from "../src/store";
import { cleanupTempRoots, freshStore, repo, seed } from "./support";

afterAll(cleanupTempRoots);

/** A small project extracted into a store, ready to drift. */
async function extracted(): Promise<{ store: PatternStore; root: string }> {
  const store = await freshStore();
  const root = await repo({
    "package.json": JSON.stringify({
      name: "widget",
      scripts: { test: "bun test" },
      dependencies: { zod: "^4.0.0" },
    }),
    "biome.json": JSON.stringify({ formatter: { lineWidth: 100 } }, null, 2),
    "src/Index.ts": "export {};\n",
    "src/Widget.ts": "export {};\n",
    "README.md": "# widget\n",
  });
  await saveExtractedPattern(store, await extractPattern(root, "widget"));
  return { store, root };
}

describe("drift", () => {
  test("a project that matches its pattern proposes nothing", async () => {
    const { store, root } = await extracted();
    expect(await learnDrift(store, "widget", root)).toEqual([]);
  });

  test("new verbs, purposes, layout entries, and drifted configs become proposals", async () => {
    const { store, root } = await extracted();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "widget",
        scripts: { test: "bun test", lint: "biome lint ." },
        dependencies: { zod: "^4.0.0", hono: "^4.0.0" },
      }),
    );
    await writeFile(join(root, "biome.json"), JSON.stringify({ formatter: { lineWidth: 120 } }));
    await mkdir(join(root, "scripts"), { recursive: true });
    await writeFile(join(root, "scripts", "release.sh"), "echo hi\n");

    const proposals = await learnDrift(store, "widget", root);
    const byPath = Object.fromEntries(proposals.map((p) => [p.path.join("/"), p]));
    expect(byPath["commands/lint"]?.value).toBe("biome lint .");
    expect(byPath["dependencies/runtime/web-framework"]?.value).toBe("hono");
    expect(byPath.layout?.value).toMatchObject({ path: "scripts/" });
    const config = byPath["toolchain/configs/biome.json"];
    expect(config?.before).toBe("toolchain/biome.json");
    expect(config?.files?.["toolchain/biome.json"]).toContain("120");
    // Keys carry dots, so the path is segments, never a dotted string.
    expect(config?.path).toEqual(["toolchain", "configs", "biome.json"]);
  });

  test("lists only grow, and nothing is ever taken away", async () => {
    const store = await freshStore();
    await seed(store, {
      name: "widget",
      languages: { programming: ["TypeScript", "Vue"] },
      commands: { test: "bun test", build: "bun build" },
    });
    const root = await repo({
      "package.json": JSON.stringify({ name: "widget", scripts: { test: "bun test" } }),
      "src/Index.ts": "export {};\n",
    });
    const proposals = await learnDrift(store, "widget", root);
    expect(proposals.filter((p) => p.path[0] === "languages")).toEqual([]);
    expect(proposals.filter((p) => p.path[0] === "commands")).toEqual([]);
  });
});

describe("drafting", () => {
  const doc = {
    pattern: { format: 1 as const, name: "widget", description: "", layout: [] },
    prose: "Keep it small.\n\n## Extraction notes\n\n### Layout\n\n- a note",
  };

  test("applies facets by segments, keeps layout sorted, and leaves the input alone", () => {
    const draft = draftDocument(doc, [
      { path: ["naming", "extensions", ".ts"], value: "camelCase", reason: "" },
      { path: ["layout"], value: { path: "src/", required: true }, reason: "" },
      { path: ["layout"], value: { path: "README.md", required: true }, reason: "" },
    ]);
    expect(draft.pattern.naming?.extensions?.[".ts"]).toBe("camelCase");
    expect(draft.pattern.layout.map((entry) => entry.path)).toEqual(["README.md", "src/"]);
    expect(doc.pattern.layout).toEqual([]);
  });

  test("convention lines join the prose above the extraction notes, as one list", () => {
    const draft = draftDocument(doc, [
      { path: ["prose"], value: "Errors are raised as domain errors.", reason: "" },
      { path: ["prose"], value: "Routers translate them to HTTP.", reason: "" },
    ]);
    expect(draft.prose).toBe(
      "Keep it small.\n\n- Errors are raised as domain errors.\n- Routers translate them to HTTP.\n\n## Extraction notes\n\n### Layout\n\n- a note",
    );
  });

  test("saving writes the document and the captured bytes, prose kept", async () => {
    const { store, root } = await extracted();
    await writeFile(join(root, "biome.json"), JSON.stringify({ formatter: { lineWidth: 120 } }));
    const proposals = await learnDrift(store, "widget", root);
    const before = await store.load("widget");
    await saveLearned(store, "widget", [
      ...proposals,
      { path: ["prose"], value: "One convention.", reason: "" },
    ]);
    const after = await store.load("widget");
    expect(after.prose).toContain(before.prose.split("\n")[0] as string);
    expect(after.prose).toContain("- One convention.");
    expect(
      await readFile(join(store.dirOf("widget"), "toolchain", "biome.json"), "utf8"),
    ).toContain("120");
  });

  test("a proposal renders as the diff it would make, to pattern.md or to the captured file", async () => {
    const { store, root } = await extracted();
    const loaded = await store.load("widget");
    const facet = await renderProposal(store, loaded, {
      path: ["commands", "lint"],
      value: "biome lint .",
      reason: "",
    });
    expect(facet).toContain("+   lint: biome lint .");
    await writeFile(join(root, "biome.json"), JSON.stringify({ formatter: { lineWidth: 120 } }));
    const [config] = await learnDrift(store, "widget", root);
    const file = await renderProposal(store, loaded, config as Proposal);
    expect(file.split("\n")[0]).toBe("toolchain/biome.json");
    expect(file).toContain("+");
  });

  test("unifiedDiff shows changed lines with two lines of context", () => {
    const diff = unifiedDiff("a\nb\nc\nd\ne\nf\ng", "a\nb\nc\nX\ne\nf\ng");
    expect(diff).toBe("  b\n  c\n- d\n+ X\n  e\n  f");
  });
});

describe("conventions", () => {
  const realFetch = globalThis.fetch;
  let outerHome: string | undefined;
  let outerKey: string | undefined;
  let requests: { body: { messages?: { content: string }[]; system?: string } }[];

  beforeEach(async () => {
    outerHome = process.env.DOLLY_HOME;
    outerKey = process.env.ANTHROPIC_API_KEY;
    process.env.DOLLY_HOME = await mkdtemp(join(tmpdir(), "dolly-learn-ai-"));
    requests = [];
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (outerHome === undefined) delete process.env.DOLLY_HOME;
    else process.env.DOLLY_HOME = outerHome;
    if (outerKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = outerKey;
  });

  function stubModel(text: string): void {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push({ body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 });
    }) as typeof fetch;
  }

  async function turnOn(): Promise<void> {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    await writeFile(
      join(process.env.DOLLY_HOME as string, "ai.json"),
      JSON.stringify({ provider: "anthropic" }),
    );
  }

  test("with the layer off nothing is called and nothing is drafted", async () => {
    const { store, root } = await extracted();
    stubModel("- anything");
    const drafted = await draftConventions(await store.load("widget"), root, ["src/Widget.ts"], []);
    expect(drafted).toEqual([]);
    expect(requests.length).toBe(0);
  });

  test("with the layer on, changed files are shown and only bullet lines come back", async () => {
    const { store, root } = await extracted();
    await turnOn();
    stubModel(
      "Here are some conventions:\n- Widgets never import from src/Index.ts.\n* Tests sit beside their module.\nThat is all.",
    );
    const drafted = await draftConventions(
      await store.load("widget"),
      root,
      ["src/Widget.ts"],
      [{ path: ["commands", "lint"], value: "biome lint .", reason: "a new verb" }],
    );
    expect(drafted.map((p) => p.value)).toEqual([
      "Widgets never import from src/Index.ts.",
      "Tests sit beside their module.",
    ]);
    expect(drafted[0]?.path).toEqual(["prose"]);
    expect(drafted[0]?.reason).toContain("claude-sonnet-5");
    const sent = requests[0]?.body.messages?.[0]?.content ?? "";
    expect(sent).toContain("--- src/Widget.ts");
    expect(sent).toContain("commands.lint: a new verb");
  });

  test("no changed files means no call, and a provider failure drafts nothing", async () => {
    const { store, root } = await extracted();
    await turnOn();
    stubModel("- anything");
    expect(await draftConventions(await store.load("widget"), root, [], [])).toEqual([]);
    expect(requests.length).toBe(0);
    globalThis.fetch = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    expect(await draftConventions(await store.load("widget"), root, ["src/Widget.ts"], [])).toEqual(
      [],
    );
  });
});
