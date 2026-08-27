import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PatternStore } from "@dolly/core";
import pkg from "../package.json";
import { type DollyServer, serveDolly } from "../src/serve";

let home: string;
let server: DollyServer;
const outerHome = process.env.DOLLY_HOME;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "dolly-serve-"));
  process.env.DOLLY_HOME = home; // the AI switch reads its settings from here
  server = serveDolly({
    port: 0,
    store: new PatternStore(join(home, "patterns")),
    uiDir: join(home, "no-ui"), // hermetic: never pick up the repo's real build
  });
});

afterEach(() => {
  server.stop();
  if (outerHome === undefined) delete process.env.DOLLY_HOME;
  else process.env.DOLLY_HOME = outerHome;
});

function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`http://127.0.0.1:${server.port}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${server.token}`, ...(init.headers ?? {}) },
  });
}

async function seedPattern(name: string, patternMd: string): Promise<string> {
  const dir = join(home, "patterns", name);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "pattern.md");
  await writeFile(path, patternMd);
  return path;
}

/** A project directory carrying a .dolly marker for the given pattern. */
async function markedProject(pattern: string): Promise<string> {
  const dir = join(home, "project");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, ".dolly"), `pattern: ${pattern}\n`);
  return dir;
}

const DOCS_REQUIRED = [
  "---",
  "name: tidy",
  "description: Keep it tidy.",
  "layout:",
  "  - path: docs/",
  "    required: true",
  "---",
  "",
].join("\n");

/** The wire shapes under test, mirrored from docs/design/gui.md. */
interface PatternWire {
  name: string;
  source: string;
  pattern?: { name: string };
  prose?: string;
  error?: string;
}

interface CheckWire {
  pattern: string;
  violations: { rule: string; path: string; message: string; fixable: boolean }[];
  fixed: string[];
  diagnostics: string[];
}

interface FitWire {
  pattern: string;
  git: string;
  steps: unknown[];
  declined: { path: string; message: string }[];
  diagnostics: string[];
}

function body<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

/** Raw HTTP, for requests fetch refuses to send (foreign Host, raw traversal). */
function rawRequest(request: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const socket = createConnection(server.port, "127.0.0.1");
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk.toString();
    });
    socket.on("end", () => resolvePromise(data));
    socket.on("error", reject);
    socket.write(request);
  });
}

describe("dolly serve", () => {
  test("every /api route demands this run's token", async () => {
    const bare = await fetch(`http://127.0.0.1:${server.port}/api/health`);
    expect(bare.status).toBe(401);

    const wrong = await fetch(`http://127.0.0.1:${server.port}/api/health`, {
      headers: { authorization: "Bearer not-the-token" },
    });
    expect(wrong.status).toBe(401);

    const ok = await api("/api/health");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      name: "dolly",
      version: pkg.version,
      home: expect.stringMatching(/patterns$/),
    });
  });

  test("ai reports the switch the way `dolly ai status` does", async () => {
    const status = await body<{
      provider: string | null;
      model: string | null;
      keySource: string | null;
    }>(await api("/api/ai"));
    expect(status).toEqual({ provider: null, model: null, keySource: null });
  });

  test("ai reports a connected provider, with the key's source", async () => {
    await writeFile(join(home, "ai.json"), JSON.stringify({ provider: "anthropic" }));
    const outerKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-test";
    try {
      const status = await body<{ provider: string; model: string; keySource: string }>(
        await api("/api/ai"),
      );
      expect(status).toEqual({
        provider: "anthropic",
        model: "claude-sonnet-5",
        keySource: "environment",
      });
    } finally {
      if (outerKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = outerKey;
    }
  });

  test("the settings routes mirror dolly ai: providers, use, off, and connect's refusals", async () => {
    const outerKey = process.env.ANTHROPIC_API_KEY;
    const realFetch = globalThis.fetch;
    process.env.ANTHROPIC_API_KEY = "sk-test";
    try {
      const providers = await body<{ id: string; keySource: string }[]>(
        await api("/api/ai/providers"),
      );
      expect(providers.map((p) => `${p.id}:${p.keySource}`)).toEqual([
        "anthropic:environment",
        "openai:missing",
        "google:missing",
      ]);

      const used = await api("/api/ai/use", {
        method: "POST",
        body: JSON.stringify({ provider: "anthropic", model: "claude-opus-5" }),
      });
      expect(await body<{ model: string }>(used)).toMatchObject({
        provider: "anthropic",
        model: "claude-opus-5",
      });

      const noKey = await api("/api/ai/use", {
        method: "POST",
        body: JSON.stringify({ provider: "google" }),
      });
      expect(noKey.status).toBe(400);
      expect((await body<{ error: string }>(noKey)).error).toContain("No key for Google");

      const unknown = await api("/api/ai/connect", {
        method: "POST",
        body: JSON.stringify({ provider: "acme", key: "sk-x" }),
      });
      expect(unknown.status).toBe(400);

      // The provider's own refusal comes back as a 400 in its words; the daemon's API stays reachable.
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).includes("api.openai.com")) {
          return new Response(
            JSON.stringify({ error: { message: "Incorrect API key provided" } }),
            {
              status: 401,
            },
          );
        }
        return realFetch(url, init);
      }) as typeof fetch;
      const refused = await api("/api/ai/connect", {
        method: "POST",
        body: JSON.stringify({ provider: "openai", key: "sk-wrong" }),
      });
      expect(refused.status).toBe(400);
      expect((await body<{ error: string }>(refused)).error).toContain("OpenAI");

      const off = await body<{ provider: string | null }>(
        await api("/api/ai/off", { method: "POST" }),
      );
      expect(off.provider).toBeNull();
    } finally {
      globalThis.fetch = realFetch;
      if (outerKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = outerKey;
    }
  });

  test("a foreign Host header is refused even with the token", async () => {
    const response = await rawRequest(
      `GET /api/health HTTP/1.1\r\nHost: evil.example\r\nAuthorization: Bearer ${server.token}\r\nConnection: close\r\n\r\n`,
    );
    expect(response).toContain("403");
    expect(response).toContain("localhost");
  });

  test("patterns round-trip: list, get, edit, delete", async () => {
    await seedPattern("tidy", DOCS_REQUIRED);

    const list = await (await api("/api/patterns")).json();
    expect(list).toEqual([{ name: "tidy", description: "Keep it tidy." }]);

    const got = await body<PatternWire>(await api("/api/patterns/tidy"));
    expect(got.source).toBe(DOCS_REQUIRED);
    expect(got.pattern?.name).toBe("tidy");
    expect(got.error).toBeUndefined();

    // The edit is written byte-for-byte; the author's formatting is theirs.
    const edited = `${DOCS_REQUIRED}\nProse the engine ignores.\n`;
    const put = await api("/api/patterns/tidy", { method: "PUT", body: edited });
    expect(put.status).toBe(200);
    expect((await body<PatternWire>(put)).prose).toBe("Prose the engine ignores.");
    expect(await readFile(join(home, "patterns", "tidy", "pattern.md"), "utf8")).toBe(edited);

    const del = await api("/api/patterns/tidy", { method: "DELETE" });
    expect(del.status).toBe(200);
    expect((await api("/api/patterns/tidy")).status).toBe(404);
  });

  test("an invalid edit is a 422 and writes nothing", async () => {
    await seedPattern("tidy", DOCS_REQUIRED);
    const put = await api("/api/patterns/tidy", {
      method: "PUT",
      body: "---\nname: Not Valid\n---\n",
    });
    expect(put.status).toBe(422);
    expect((await body<PatternWire>(put)).error).toContain("Invalid pattern facets");
    expect(await readFile(join(home, "patterns", "tidy", "pattern.md"), "utf8")).toBe(
      DOCS_REQUIRED,
    );
  });

  test("a pattern over 1 MiB is a 413 that writes nothing, and unsupported methods are 405", async () => {
    const path = await seedPattern("tidy", DOCS_REQUIRED);
    const huge = await api("/api/patterns/tidy", {
      method: "PUT",
      body: "x".repeat(1024 * 1024 + 1),
    });
    expect(huge.status).toBe(413);
    expect(await readFile(path, "utf8")).toBe(DOCS_REQUIRED);
    expect((await api("/api/patterns/tidy", { method: "PATCH", body: "" })).status).toBe(405);
    expect((await fetch(`http://127.0.0.1:${server.port}/`, { method: "POST" })).status).toBe(405);
  });

  test("a broken pattern returns its source and the parse error, which the editor needs most", async () => {
    await seedPattern("broken", "---\nname: broken\nlayotu: []\n---\n");
    const got = await body<PatternWire>(await api("/api/patterns/broken"));
    expect(got.source).toContain("layotu");
    expect(got.error).toContain("Invalid pattern facets");
    expect(got.pattern).toBeUndefined();
  });

  test("editing is not creating: PUT to an unknown pattern is a 404", async () => {
    const put = await api("/api/patterns/ghost", {
      method: "PUT",
      body: "---\nname: ghost\n---\n",
    });
    expect(put.status).toBe(404);
  });

  test("check resolves the marker, reports fixable violations, and fixes on request", async () => {
    await seedPattern("tidy", DOCS_REQUIRED);
    const project = await markedProject("tidy");

    const dirty = await body<CheckWire>(
      await api("/api/check", { method: "POST", body: JSON.stringify({ dir: project }) }),
    );
    expect(dirty.pattern).toBe("tidy");
    expect(dirty.violations).toEqual([
      { rule: "layout", path: "docs/", message: expect.any(String), fixable: true },
    ]);

    const fixed = await body<CheckWire>(
      await api("/api/check", {
        method: "POST",
        body: JSON.stringify({ dir: project, fix: true }),
      }),
    );
    expect(fixed.fixed).toHaveLength(1);
    expect(fixed.violations).toEqual([]);
  });

  test("fit plans over the wire as data, and apply names its git precondition", async () => {
    await seedPattern(
      "kebab",
      ["---", "name: kebab", "naming:", "  files: kebab-case", "---", ""].join("\n"),
    );
    const project = await markedProject("kebab");
    await mkdir(join(project, "src"), { recursive: true });
    await writeFile(join(project, "src", "MyHelper.ts"), "export const helper = 1;\n");
    await writeFile(join(project, "src", "app.ts"), 'export { helper } from "./MyHelper";\n');

    const plan = await body<FitWire>(
      await api("/api/fit", { method: "POST", body: JSON.stringify({ dir: project }) }),
    );
    expect(plan.pattern).toBe("kebab");
    expect(plan.git).toBe("missing");
    expect(plan.steps).toEqual([
      {
        kind: "move",
        rule: "naming",
        from: "src/MyHelper.ts",
        to: "src/my-helper.ts",
        reason: expect.any(String),
        rewrites: [
          { file: "src/app.ts", from: "./MyHelper", to: "./my-helper", target: "src/MyHelper.ts" },
        ],
      },
    ]);
    // Nothing was written: fit without apply is a read.
    expect(await Bun.file(join(project, "src", "MyHelper.ts")).exists()).toBe(true);

    const refused = await api("/api/fit", {
      method: "POST",
      body: JSON.stringify({ dir: project, apply: true }),
    });
    expect(refused.status).toBe(409);
    expect((await body<PatternWire>(refused)).error).toContain("git repository");
  });

  test("export previews a rendered target and saves it into the project, refusing to overwrite", async () => {
    await seedPattern("tidy", DOCS_REQUIRED);
    const project = await markedProject("tidy");

    // The pattern comes from the marker, like every project route.
    const query = (params: string) =>
      api(`/api/export?dir=${encodeURIComponent(project)}&${params}`);
    const preview = await body<{ pattern: string; target: string; path: string; contents: string }>(
      await query("as=agents-md"),
    );
    expect(preview).toEqual({
      pattern: "tidy",
      target: "agents-md",
      path: "AGENTS.md",
      contents: expect.stringContaining("- `docs/` (required)"),
    });
    expect((await query("pattern=tidy&as=bundle")).status).toBe(400);
    expect((await query("pattern=ghost&as=prompt")).status).toBe(404);

    const save = (force?: boolean) =>
      api("/api/export", {
        method: "POST",
        body: JSON.stringify({ dir: project, as: "agents-md", force }),
      });
    const saved = await body<{ path: string }>(await save());
    expect(saved.path).toBe(join(project, "AGENTS.md"));
    expect(await readFile(saved.path, "utf8")).toBe(preview.contents);
    expect((await save()).status).toBe(409);
    expect((await save(true)).status).toBe(200);
  });

  test("extract, new, import, and the bundle save: the verbs the pickers unlocked", async () => {
    const project = join(home, "widget");
    await mkdir(join(project, "src"), { recursive: true });
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({ name: "widget", scripts: { test: "bun test" } }),
    );
    await writeFile(join(project, "src/index.ts"), "export {};\n");

    const extract = (force?: boolean) =>
      api("/api/extract", {
        method: "POST",
        body: JSON.stringify({ dir: project, name: "widget", force }),
      });
    const extracted = await body<{ name: string; facets: string[]; captured: number }>(
      await extract(),
    );
    expect(extracted.name).toBe("widget");
    expect(extracted.facets).toContain("commands");
    expect((await extract()).status).toBe(409); // the pattern exists now
    expect((await extract(true)).status).toBe(200);

    const fresh = join(home, "fresh");
    const scaffold = () =>
      api("/api/new", { method: "POST", body: JSON.stringify({ pattern: "widget", dir: fresh }) });
    const report = await body<{ root: string; created: string[] }>(await scaffold());
    expect(report.root).toBe(fresh);
    expect(report.created).toContain("package.json");
    expect((await scaffold()).status).toBe(409); // not empty any more

    const bundle = await body<{ path: string }>(
      await api("/api/export", {
        method: "POST",
        body: JSON.stringify({ out: join(home, "widget.dolly"), pattern: "widget", as: "bundle" }),
      }),
    );
    expect(bundle.path).toBe(join(home, "widget.dolly"));

    const importIt = (force?: boolean) =>
      api("/api/import", { method: "POST", body: JSON.stringify({ file: bundle.path, force }) });
    expect((await importIt()).status).toBe(409);
    expect(await body<{ name: string; description: string }>(await importIt(true))).toEqual({
      name: "widget",
      description: "Extracted from the widget project.",
    });
    const notABundle = await api("/api/import", {
      method: "POST",
      body: JSON.stringify({ file: join(project, "package.json") }),
    });
    expect(notABundle.status).toBe(400);
  });

  test("check without a pattern or marker explains itself", async () => {
    const bare = join(home, "unmarked");
    await mkdir(bare, { recursive: true });
    const response = await api("/api/check", {
      method: "POST",
      body: JSON.stringify({ dir: bare }),
    });
    expect(response.status).toBe(400);
    expect((await body<PatternWire>(response)).error).toContain(".dolly marker");
  });

  test("watch streams a report now and another after the tree changes", async () => {
    await seedPattern("tidy", DOCS_REQUIRED);
    const project = await markedProject("tidy");

    const aborter = new AbortController();
    const response = await api(`/api/watch?dir=${encodeURIComponent(project)}`, {
      signal: aborter.signal,
    });
    expect(response.status).toBe(200);

    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const nextReport = async () => {
      while (!buffer.includes("\n")) {
        const { value, done } = await reader.read();
        if (done) throw new Error("the watch stream ended early");
        buffer += decoder.decode(value);
      }
      const cut = buffer.indexOf("\n");
      const line = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 1);
      return JSON.parse(line) as CheckWire;
    };

    const first = await nextReport();
    expect(first.violations).toHaveLength(1);

    await mkdir(join(project, "docs"), { recursive: true });
    const second = await nextReport(); // arrives after the 300ms debounce
    expect(second.violations).toEqual([]);

    aborter.abort();
  });

  test("learn streams proposals now and again after the tree changes, then writes the accepted set", async () => {
    await seedPattern("tidy", DOCS_REQUIRED);
    const project = await markedProject("tidy");
    await mkdir(join(project, "docs"), { recursive: true });
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({ name: "tidy", scripts: { test: "bun test" } }),
    );

    // macOS file events can replay the writes above into a watcher that starts right after them.
    await new Promise((settle) => setTimeout(settle, 200));
    const aborter = new AbortController();
    const response = await api(`/api/learn?dir=${encodeURIComponent(project)}`, {
      signal: aborter.signal,
    });
    expect(response.status).toBe(200);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const next = async () => {
      while (!buffer.includes("\n")) {
        const { value, done } = await reader.read();
        if (done) throw new Error("the learn stream ended early");
        buffer += decoder.decode(value);
      }
      const cut = buffer.indexOf("\n");
      const line = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 1);
      return JSON.parse(line) as {
        pattern: string;
        proposals: { path: string[]; value: unknown; diff: string }[];
        changed: string[];
      };
    };

    const first = await next();
    expect(first.pattern).toBe("tidy"); // resolved from the marker, named on the wire
    const paths = first.proposals.map((p) => p.path.join("."));
    expect(paths).toContain("commands.test");
    expect(first.changed).toEqual([]);

    await writeFile(
      join(project, "package.json"),
      JSON.stringify({ name: "tidy", scripts: { test: "bun test", lint: "biome lint ." } }),
    );
    const second = await next(); // after the watcher's debounce
    expect(second.proposals.map((p) => p.path.join("."))).toContain("commands.lint");
    expect(second.changed).toContain("package.json");
    expect(second.proposals.find((p) => p.path.join(".") === "commands.lint")?.diff).toContain(
      "+   lint: biome lint .",
    );
    aborter.abort();

    const lint = second.proposals.find((p) => p.path.join(".") === "commands.lint");
    const written = await api("/api/learn", {
      method: "POST",
      body: JSON.stringify({ dir: project, accepted: [lint] }),
    });
    expect(await body<{ pattern: string; written: number }>(written)).toEqual({
      pattern: "tidy",
      written: 1,
    });
    expect(await readFile(join(home, "patterns", "tidy", "pattern.md"), "utf8")).toContain(
      "lint: biome lint .",
    );

    // A captured path that leaves the pattern directory is refused before anything is written.
    const escaping = await api("/api/learn", {
      method: "POST",
      body: JSON.stringify({
        dir: project,
        accepted: [
          {
            path: ["toolchain", "configs", "x"],
            value: "../x",
            reason: "",
            files: { "../x": "boom" },
          },
        ],
      }),
    });
    expect(escaping.status).toBe(400);

    // With the AI layer off, drafting is an empty list and no call is made.
    const drafted = await api("/api/learn/draft", {
      method: "POST",
      body: JSON.stringify({ dir: project, changed: ["package.json"], proposals: [] }),
    });
    expect(await body<unknown[]>(drafted)).toEqual([]);
  });

  test("watch of an unknown pattern is a 404, not a stream of errors", async () => {
    const project = await markedProject("ghost");
    const response = await api(`/api/watch?dir=${encodeURIComponent(project)}`);
    expect(response.status).toBe(404);
  });

  test("serves the built webview at / without a token, refusing traversal", async () => {
    const ui = join(home, "dist");
    await mkdir(join(ui, "assets"), { recursive: true });
    await writeFile(join(ui, "index.html"), "<!doctype html><title>dolly</title>");
    await writeFile(join(ui, "assets", "app.js"), "console.log('dolly');\n");
    await writeFile(join(home, "secret.txt"), "not served\n");

    const withUi = serveDolly({
      port: 0,
      store: new PatternStore(join(home, "patterns")),
      uiDir: ui,
    });
    try {
      const page = await fetch(`http://127.0.0.1:${withUi.port}/`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("<title>dolly</title>");

      const asset = await fetch(`http://127.0.0.1:${withUi.port}/assets/app.js`);
      expect(asset.status).toBe(200);

      // fetch normalizes "..", so walk the raw socket like an attacker would.
      const raw = await new Promise<string>((resolvePromise, reject) => {
        const socket = createConnection(withUi.port, "127.0.0.1");
        let data = "";
        socket.on("data", (chunk) => {
          data += chunk.toString();
        });
        socket.on("end", () => resolvePromise(data));
        socket.on("error", reject);
        socket.write(
          "GET /..%2fsecret.txt HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
        );
      });
      expect(raw).toContain("404");
      expect(raw).not.toContain("not served");
    } finally {
      withUi.stop();
    }
  });

  test("without a built webview, / says so instead of pretending", async () => {
    const page = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("API only");
  });
});
