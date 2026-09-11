import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activeAi, aiOff, aiStatus, connectAi, useAi, verifyAi } from "../src/ai/ai";
import { assistedCheck } from "../src/ai/check";
import { findKey, KeychainUnavailableError, storeKey } from "../src/ai/keys";
import { assistedFit } from "../src/ai/placement";
import { AiProviderError, complete, verifyKey } from "../src/ai/providers";
import { patternSchema } from "../src/pattern/schema";
import { cleanupTempRoots, freshStore, repo, seed } from "./support";

afterAll(cleanupTempRoots);

/** Every env var the ai layer reads, saved and restored around each test. */
const ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "PATH",
  "DOLLY_HOME",
] as const;

const realFetch = globalThis.fetch;
let savedEnv: Record<string, string | undefined>;
let requests: Array<{ url: string; headers: Record<string, string>; body: unknown }>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_VARS.map((name) => [name, process.env[name]]));
  for (const name of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]) {
    delete process.env[name];
  }
  requests = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function stubFetch(status: number, responseBody: unknown): void {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    });
    return new Response(JSON.stringify(responseBody), { status });
  }) as typeof fetch;
}

/**
 * A fake secret-tool on PATH: stores to and reads from files beside itself,
 * speaking just enough of the real tool's argv to prove ours is right.
 */
async function fakeKeychain(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dolly-keychain-"));
  const script = [
    "#!/usr/bin/env bash",
    'mode="$1"; shift',
    'account=""; prev=""',
    'for arg in "$@"; do',
    '  if [ "$prev" = "account" ]; then account="$arg"; fi',
    '  prev="$arg"',
    "done",
    'file="$(dirname "$0")/stored-$account"',
    'case "$mode" in',
    '  store) cat > "$file" ;;',
    '  lookup) [ -f "$file" ] || exit 1; cat "$file" ;;',
    "  *) exit 2 ;;",
    "esac",
  ].join("\n");
  await writeFile(join(dir, "secret-tool"), `${script}\n`);
  await chmod(join(dir, "secret-tool"), 0o755);
  return dir;
}

/** A PATH that keeps the system tools but resolves secret-tool to the fake. */
function frontLoadPath(dir: string): void {
  process.env.PATH = `${dir}:${savedEnv.PATH ?? ""}`;
}

describe("provider adapters", () => {
  test("anthropic: wire shape out, text back", async () => {
    stubFetch(200, { content: [{ type: "text", text: "placed" }] });
    const reply = await complete(
      "anthropic",
      { system: "sys", prompt: "where?", maxTokens: 9 },
      "sk-a",
      "claude-test",
    );
    expect(reply).toBe("placed");
    const [request] = requests;
    expect(request?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request?.headers["x-api-key"]).toBe("sk-a");
    expect(request?.headers["anthropic-version"]).toBeDefined();
    expect(request?.body).toMatchObject({
      model: "claude-test",
      max_tokens: 9,
      system: "sys",
      messages: [{ role: "user", content: "where?" }],
    });
  });

  test("openai: bearer auth, system message, max_completion_tokens", async () => {
    stubFetch(200, { choices: [{ message: { content: "ok" } }] });
    const reply = await complete(
      "openai",
      { system: "sys", prompt: "hi", maxTokens: 5 },
      "sk-o",
      "gpt-test",
    );
    expect(reply).toBe("ok");
    const [request] = requests;
    expect(request?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(request?.headers.authorization).toBe("Bearer sk-o");
    expect(request?.body).toMatchObject({
      model: "gpt-test",
      max_completion_tokens: 5,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
    });
  });

  test("google: model in the URL, key in the header, parts unwrapped", async () => {
    stubFetch(200, { candidates: [{ content: { parts: [{ text: "ok" }] } }] });
    const reply = await complete(
      "google",
      { system: "sys", prompt: "hi", maxTokens: 5 },
      "g-key",
      "gemini-test",
    );
    expect(reply).toBe("ok");
    const [request] = requests;
    expect(request?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent",
    );
    expect(request?.headers["x-goog-api-key"]).toBe("g-key");
    expect(request?.body).toMatchObject({
      systemInstruction: { parts: [{ text: "sys" }] },
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      generationConfig: { maxOutputTokens: 5 },
    });
  });

  test("a provider error surfaces its words with the key redacted", async () => {
    stubFetch(401, { error: { message: "invalid key sk-oops, check the dashboard" } });
    let thrown: unknown;
    try {
      await complete("anthropic", { prompt: "hi" }, "sk-oops", "m");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AiProviderError);
    const message = (thrown as Error).message;
    expect(message).toContain("HTTP 401");
    expect(message).toContain("invalid key");
    expect(message).not.toContain("sk-oops");
  });

  test("a 2xx that carries no text is an error for complete", async () => {
    stubFetch(200, {});
    await expect(complete("anthropic", { prompt: "hi" }, "k", "m")).rejects.toThrow(
      "carried no text",
    );
  });

  test("verifyKey demands only a 2xx, so a reply burned on reasoning still verifies", async () => {
    stubFetch(200, {});
    await verifyKey("openai", "sk-v", "gpt-test");
    expect(requests.length).toBe(1);
  });
});

describe.skipIf(process.platform !== "linux")("keys", () => {
  test("store and find round-trip through the keychain tool", async () => {
    frontLoadPath(await fakeKeychain());
    await storeKey("anthropic", "sk-round");
    const found = await findKey("anthropic");
    expect(found).toEqual({ key: "sk-round", source: "keychain" });
  });

  test("the environment wins over a stored key", async () => {
    frontLoadPath(await fakeKeychain());
    await storeKey("anthropic", "sk-stored");
    process.env.ANTHROPIC_API_KEY = "sk-env";
    const found = await findKey("anthropic");
    expect(found).toEqual({ key: "sk-env", source: "environment" });
  });

  test("GOOGLE_API_KEY is honored as google's fallback variable", async () => {
    process.env.GOOGLE_API_KEY = "g-env";
    const found = await findKey("google");
    expect(found).toEqual({ key: "g-env", source: "environment" });
  });

  test("no keychain tool: an honest refusal naming the env var, never a file", async () => {
    const empty = await mkdtemp(join(tmpdir(), "dolly-nopath-"));
    process.env.PATH = empty;
    await expect(storeKey("anthropic", "sk-x")).rejects.toThrow(KeychainUnavailableError);
    await expect(storeKey("anthropic", "sk-x")).rejects.toThrow("ANTHROPIC_API_KEY");
    expect(await findKey("anthropic")).toBeNull();
  });
});

describe("the switch", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dolly-ai-"));
    process.env.DOLLY_HOME = home;
  });

  test("off by default: null status, null client", async () => {
    expect(await aiStatus()).toEqual({ provider: null, model: null, keySource: null });
    expect(await activeAi()).toBeNull();
  });

  test("use refuses without a key, naming both ways to supply one", async () => {
    process.env.PATH = await mkdtemp(join(tmpdir(), "dolly-nopath-"));
    await expect(useAi("anthropic")).rejects.toThrow("No key for Anthropic");
    await expect(useAi("anthropic")).rejects.toThrow("ANTHROPIC_API_KEY");
    expect(await activeAi()).toBeNull();
  });

  test("use with an env key writes the switch; off deletes it", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-x";
    const status = await useAi("anthropic");
    expect(status).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5",
      keySource: "environment",
    });
    const written = JSON.parse(await readFile(join(home, "ai.json"), "utf8"));
    expect(written).toEqual({ provider: "anthropic" });
    expect(await aiStatus()).toEqual(status);
    expect((await activeAi())?.model).toBe("claude-sonnet-5");

    await aiOff();
    expect(await activeAi()).toBeNull();
    expect((await aiStatus()).provider).toBeNull();
  });

  test("an explicit model rides the switch", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-x";
    const status = await useAi("anthropic", "claude-pinned");
    expect(status.model).toBe("claude-pinned");
    expect((await activeAi())?.model).toBe("claude-pinned");
  });

  test("an unknown provider is refused by name", async () => {
    await expect(useAi("mistral")).rejects.toThrow('Unknown provider "mistral"');
  });

  test("a selection whose key vanished reads as off, not as an error", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-x";
    await useAi("anthropic");
    delete process.env.ANTHROPIC_API_KEY;
    process.env.PATH = await mkdtemp(join(tmpdir(), "dolly-nopath-"));
    expect(await activeAi()).toBeNull();
    expect((await aiStatus()).keySource).toBe("missing");
  });

  test("verify makes one live round trip and reports the provider's verdict", async () => {
    expect(await verifyAi()).toEqual({ status: { provider: null, model: null, keySource: null } });
    process.env.ANTHROPIC_API_KEY = "sk-verify";
    await useAi("anthropic");
    stubFetch(200, { content: [{ type: "text", text: "ok" }] });
    expect((await verifyAi()).error).toBeUndefined();
    stubFetch(401, { error: { message: "API key is invalid" } });
    expect((await verifyAi()).error).toBe("Anthropic: HTTP 401: API key is invalid");
  });

  test("the client completes through the adapter with the resolved key", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-live";
    await useAi("anthropic");
    stubFetch(200, { content: [{ type: "text", text: "hello" }] });
    const client = await activeAi();
    expect(await client?.complete({ prompt: "hi" })).toBe("hello");
    expect(requests[0]?.headers["x-api-key"]).toBe("sk-live");
  });
});

describe.skipIf(process.platform !== "linux")("connect", () => {
  let home: string;
  let keychain: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dolly-ai-"));
    process.env.DOLLY_HOME = home;
    keychain = await fakeKeychain();
    frontLoadPath(keychain);
  });

  test("verify, store, and select when nothing was selected", async () => {
    stubFetch(200, {});
    const status = await connectAi("anthropic", "sk-new");
    expect(await readFile(join(keychain, "stored-anthropic"), "utf8")).toBe("sk-new");
    expect(status).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5",
      keySource: "keychain",
    });
  });

  test("a connect never steals an existing selection", async () => {
    process.env.GEMINI_API_KEY = "g-x";
    await useAi("google");
    stubFetch(200, {});
    await connectAi("anthropic", "sk-new");
    expect((await aiStatus()).provider).toBe("google");
  });

  test("a key that fails verification is never stored", async () => {
    stubFetch(401, { error: { message: "nope" } });
    await expect(connectAi("anthropic", "sk-bad")).rejects.toThrow(AiProviderError);
    await expect(stat(join(keychain, "stored-anthropic"))).rejects.toThrow();
  });

  test("a key carrying whitespace is refused before any network call", async () => {
    stubFetch(200, {});
    await expect(connectAi("anthropic", "sk bad")).rejects.toThrow("does not look like an API key");
    expect(requests.length).toBe(0);
  });
});

describe("semantic placement", () => {
  beforeEach(async () => {
    process.env.DOLLY_HOME = await mkdtemp(join(tmpdir(), "dolly-ai-"));
  });

  async function ambiguousProject() {
    const store = await freshStore();
    await seed(store, { name: "colo", testing: { placement: "colocated" } });
    const root = await repo({
      "src/a/user.ts": "export const a = 1;\n",
      "src/b/user.ts": "export const b = 1;\n",
      "tests/user.test.ts": "export {};\n",
    });
    return { store, root };
  }

  test("with AI off the plan is exactly fitProject's, and nothing is called", async () => {
    const { store, root } = await ambiguousProject();
    stubFetch(200, {});
    const plan = await assistedFit(store, "colo", root);
    expect(requests.length).toBe(0);
    const item = plan.declined.find((d) => d.candidates);
    expect(item?.candidates).toEqual(["src/a/user.test.ts", "src/b/user.test.ts"]);
    expect(item?.suggestion).toBeUndefined();
  });

  test("with AI on, an ambiguous decline carries the model's labeled pick", async () => {
    const { store, root } = await ambiguousProject();
    process.env.ANTHROPIC_API_KEY = "sk-place";
    await useAi("anthropic");
    stubFetch(200, {
      content: [{ type: "text", text: "src/b/user.test.ts\nb is the module the test imports." }],
    });
    const plan = await assistedFit(store, "colo", root);
    const item = plan.declined.find((d) => d.candidates);
    expect(item?.suggestion).toEqual({
      pick: "src/b/user.test.ts",
      why: "b is the module the test imports.",
      model: "claude-sonnet-5",
    });
    // The prompt carried the candidates and the reason for the decline.
    const body = requests[0]?.body as { messages: Array<{ content: string }> };
    expect(body.messages[0]?.content).toContain("src/a/user.test.ts");
    expect(body.messages[0]?.content).toContain("ambiguous");
    // A suggestion never becomes a step.
    expect(plan.steps.filter((s) => s.kind === "move")).toHaveLength(0);
  });

  test("a pick outside the candidate list is discarded, not trusted", async () => {
    const { store, root } = await ambiguousProject();
    process.env.ANTHROPIC_API_KEY = "sk-place";
    await useAi("anthropic");
    stubFetch(200, {
      content: [{ type: "text", text: "src/elsewhere/user.test.ts\nreads nicely." }],
    });
    const plan = await assistedFit(store, "colo", root);
    expect(plan.declined.find((d) => d.candidates)?.suggestion).toBeUndefined();
  });

  test("a provider failure leaves the plan whole and unsuggested", async () => {
    const { store, root } = await ambiguousProject();
    process.env.ANTHROPIC_API_KEY = "sk-place";
    await useAi("anthropic");
    stubFetch(500, { error: { message: "overloaded" } });
    const plan = await assistedFit(store, "colo", root);
    const item = plan.declined.find((d) => d.candidates);
    expect(item).toBeDefined();
    expect(item?.suggestion).toBeUndefined();
    // Unsuggested, but never silently: the item says which model failed and why.
    expect(item?.aiError).toBe(
      "claude-sonnet-5 could not suggest: Anthropic: HTTP 500: overloaded",
    );
  });
});

describe("the conventions check", () => {
  beforeEach(async () => {
    process.env.DOLLY_HOME = await mkdtemp(join(tmpdir(), "dolly-ai-"));
  });

  async function git(root: string, ...args: string[]): Promise<void> {
    const child = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
    if ((await child.exited) !== 0) throw new Error(`git ${args.join(" ")} failed`);
  }

  async function project() {
    const store = await freshStore();
    await store.save({
      pattern: patternSchema.parse({ name: "tidy", languages: { programming: ["TypeScript"] } }),
      prose: "Raise domain errors; translate to HTTP at the router layer.",
    });
    const root = await repo({
      "src/router.ts": "throw new Error('http 500');\n",
      "src/domain.ts": "export {};\n",
      "README.md": "# tidy\n",
    });
    return { store, root };
  }

  test("with AI off the flag refuses with the connect hint, and without it nothing is called", async () => {
    const { store, root } = await project();
    stubFetch(200, {});
    expect((await assistedCheck(store, "tidy", root)).conventions).toBeUndefined();
    await expect(assistedCheck(store, "tidy", root, { conventions: true })).rejects.toThrow(
      "needs the AI layer",
    );
    expect(requests.length).toBe(0);
  });

  test("with AI on, the code files go to the model and its lines about them come back as findings", async () => {
    const { store, root } = await project();
    process.env.ANTHROPIC_API_KEY = "sk-c";
    await useAi("anthropic");
    stubFetch(200, {
      content: [
        {
          type: "text",
          text: [
            "src/router.ts:1: throws a raw Error where the conventions want a domain error.",
            "- src/domain.ts: exports nothing, but that is not a convention",
            "src/elsewhere.ts:3: never sent, so never a finding",
            "nothing",
          ].join("\n"),
        },
      ],
    });
    const report = await assistedCheck(store, "tidy", root, { conventions: true });
    expect(report.conventions).toEqual({
      model: "claude-sonnet-5",
      findings: [
        {
          path: "src/router.ts",
          line: 1,
          message: "throws a raw Error where the conventions want a domain error.",
        },
        { path: "src/domain.ts", message: "exports nothing, but that is not a convention" },
      ],
      skipped: [],
    });
    const body = requests[0]?.body as { messages: Array<{ content: string }> };
    expect(body.messages[0]?.content).toContain("Raise domain errors");
    expect(body.messages[0]?.content).toContain("--- src/router.ts");
    expect(body.messages[0]?.content).not.toContain("README.md"); // docs are not code
    // The deterministic report stands on its own; the model's section never joins the count.
    expect(report.violations).toEqual([]);
  });

  test("under git only the files changed against HEAD are read, and the bounds are said", async () => {
    const { store, root } = await project();
    await git(root, "init", "-q");
    await git(root, "-c", "user.email=a@b", "-c", "user.name=t", "add", "-A");
    await git(root, "-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "-m", "base");
    await writeFile(join(root, "src/router.ts"), "throw new Error('changed');\n");
    await writeFile(join(root, "src/big.ts"), `export const big = "${"x".repeat(70 * 1024)}";\n`);
    process.env.ANTHROPIC_API_KEY = "sk-c";
    await useAi("anthropic");
    stubFetch(200, { content: [{ type: "text", text: "nothing" }] });
    const report = await assistedCheck(store, "tidy", root, { conventions: true });
    expect(report.conventions?.findings).toEqual([]);
    expect(report.conventions?.skipped).toEqual([
      "src/big.ts: 70 KiB is over the 64 KiB one file may be",
    ]);
    const body = requests[0]?.body as { messages: Array<{ content: string }> };
    expect(body.messages[0]?.content).toContain("--- src/router.ts");
    expect(body.messages[0]?.content).not.toContain("--- src/domain.ts"); // unchanged since HEAD
  });
});
