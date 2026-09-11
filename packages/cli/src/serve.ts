import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  AiProviderError,
  AiUsageError,
  aiOff,
  aiProviders,
  aiStatus,
  assistedCheck,
  assistedFit,
  assistedFitApply,
  checkProject,
  connectAi,
  draftConventions,
  EXPORT_TARGETS,
  ExportExistsError,
  exportPattern,
  extractFromRepos,
  extractPattern,
  FitGitError,
  facetNames,
  gitStateOf,
  InvalidBundleError,
  InvalidPatternNameError,
  ignorePaths,
  importBundle,
  linkProject,
  MarkerError,
  PatternExistsError,
  PatternNotFoundError,
  PatternParseError,
  type PatternRef,
  PatternStore,
  type Proposal,
  parsePatternDocument,
  renderExport,
  renderProposal,
  resolvePattern,
  saveExtractedPattern,
  saveLearned,
  scaffoldProject,
  TargetNotEmptyError,
  type TextTarget,
  UnsafePatternPathError,
  useAi,
  watchLearning,
  watchProject,
} from "@dollysheep/core";
import pkg from "../package.json";
import { checkView } from "./views";

/**
 * `dolly serve`: the engine's one door for the GUI (docs/design/gui.md).
 * Every route is a barrel export plus a JSON view, no logic of its own.
 * The daemon binds 127.0.0.1 only; `/api` additionally requires this run's
 * bearer token, which travels in the printed URL's fragment so it never
 * crosses the wire. A `Host` header that is not localhost is refused, so a
 * DNS-rebound website cannot reach in from a browser tab.
 */

/** "dolly" on a phone keypad. */
export const DEFAULT_PORT = 36559;

/** Longest accepted PUT body: a pattern.md is prose, not a payload. */
const MAX_PATTERN_BYTES = 1024 * 1024;

export interface ServeOptions {
  /** Port to bind (0 for an ephemeral one). Default: {@link DEFAULT_PORT}. */
  port?: number;
  store?: PatternStore;
  /** Directory holding the built webview; absent means API-only. */
  uiDir?: string;
  /** This run's bearer token; injectable for tests, random otherwise. */
  token?: string;
}

export interface DollyServer {
  port: number;
  token: string;
  /** The URL to open. The token rides the fragment, never the wire. */
  url: string;
  /** Whether a built webview is being served at `/`. */
  uiAvailable: boolean;
  stop(): void;
}

// In a repo checkout the built webview sits beside the packages; the M9
// compiled binary will embed it instead.
const UI_DIST = join(import.meta.dir, "..", "..", "..", "apps", "desktop", "dist");

export function serveDolly(options: ServeOptions = {}): DollyServer {
  const store = options.store ?? new PatternStore();
  const token = options.token ?? randomBytes(24).toString("base64url");
  const uiDir = resolve(options.uiDir ?? UI_DIST);
  const uiAvailable = existsSync(join(uiDir, "index.html"));

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? DEFAULT_PORT,
    idleTimeout: 0, // a watch stream is idle by design between reports
    fetch: (request) => handle(request, { store, token, uiDir, uiAvailable }),
  });

  const port = server.port as number; // always set for a TCP listener
  return {
    port,
    token,
    url: `http://127.0.0.1:${port}/#token=${token}`,
    uiAvailable,
    stop: () => server.stop(true),
  };
}

interface Context {
  store: PatternStore;
  token: string;
  uiDir: string;
  uiAvailable: boolean;
}

/** A path under the home directory, the way a shell would print it. */
function tilde(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

async function handle(request: Request, ctx: Context): Promise<Response> {
  // The rebinding defense: a browser that resolved evil.example to
  // 127.0.0.1 still sends "Host: evil.example".
  const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "");
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]") {
    return json({ error: "dolly serve only answers to localhost." }, 403);
  }

  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return serveStatic(request, ctx, url.pathname);

  if (!authorized(request, ctx.token)) {
    return json(
      { error: "Missing or wrong bearer token. Reopen the URL `dolly serve` printed." },
      401,
    );
  }
  try {
    return await route(request, ctx, url);
  } catch (error) {
    return errorResponse(error);
  }
}

async function route(request: Request, ctx: Context, url: URL): Promise<Response> {
  const { store } = ctx;
  const path = url.pathname;

  if (path === "/api/health" && request.method === "GET") {
    return json({ name: "dolly", version: pkg.version, home: tilde(store.root) });
  }

  if (path === "/api/ai" && request.method === "GET") {
    return json(await aiStatus()); // `dolly ai status` over HTTP, for the sidebar
  }

  // The settings surface: `dolly ai` verb for verb. A key arrives in the body
  // over loopback with the session token, the same trust as a key pasted into the CLI.
  if (path === "/api/ai/providers" && request.method === "GET") {
    return json(await aiProviders());
  }

  if (path === "/api/ai/connect" && request.method === "POST") {
    const body = (await request.json()) as { provider?: string; key?: string };
    if (!body.provider || body.key === undefined) {
      return json({ error: "`provider` and `key` are required." }, 400);
    }
    return json(await connectAi(body.provider, body.key));
  }

  if (path === "/api/ai/use" && request.method === "POST") {
    const body = (await request.json()) as { provider?: string; model?: string };
    if (!body.provider) return json({ error: "`provider` is required." }, 400);
    return json(await useAi(body.provider, body.model));
  }

  if (path === "/api/ai/off" && request.method === "POST") {
    await aiOff();
    return json(await aiStatus());
  }

  if (path === "/api/patterns" && request.method === "GET") {
    return json(await store.list());
  }

  const patternRoute = path.match(/^\/api\/patterns\/([^/]+)$/);
  if (patternRoute) {
    const name = decodeURIComponent(patternRoute[1] as string);
    switch (request.method) {
      case "GET":
        return getPattern(store, name);
      case "PUT":
        return putPattern(store, name, request);
      case "DELETE":
        await store.delete(name);
        return json({ deleted: name });
      default:
        return json({ error: `${request.method} is not supported here.` }, 405);
    }
  }

  if (path === "/api/check" && request.method === "POST") {
    const body = (await request.json()) as {
      dir?: string;
      pattern?: string;
      fix?: boolean;
      conventions?: boolean;
    };
    if (!body.dir)
      return json({ error: "`dir` is required: the project directory to check." }, 400);
    const ref = await resolvePattern(store, body.dir, body.pattern);
    if (!ref) return markerHint();
    // The deterministic report, plus the model's reading of the prose when asked (400 with AI off).
    const report = body.conventions
      ? await assistedCheck(ref.store, ref.name, body.dir, { fix: body.fix, conventions: true })
      : await checkProject(ref.store, ref.name, body.dir, { fix: body.fix });
    return json(checkView(ref.name, report));
  }

  if (path === "/api/fit" && request.method === "POST") {
    const body = (await request.json()) as { dir?: string; pattern?: string; apply?: boolean };
    if (!body.dir) return json({ error: "`dir` is required: the project directory to fit." }, 400);
    const ref = await resolvePattern(store, body.dir, body.pattern);
    if (!ref) return markerHint();
    // The plan is data end to end, so it crosses the wire as itself.
    if (body.apply) {
      const result = await assistedFitApply(ref.store, ref.name, body.dir);
      return json({
        git: "clean",
        ...result.plan,
        checkpoint: result.checkpoint,
        committed: result.committed,
        applied: result.applied,
        verified: result.verified,
        failures: result.failures,
      });
    }
    // Ambiguous declines carry a labeled AI suggestion when the layer is on.
    const plan = await assistedFit(ref.store, ref.name, body.dir);
    return json({ git: await gitStateOf(body.dir), ...plan });
  }

  if (path === "/api/watch" && request.method === "GET") {
    const dir = url.searchParams.get("dir");
    if (!dir) return json({ error: "`dir` is required: the project directory to watch." }, 400);
    const ref = await resolvePattern(store, dir, url.searchParams.get("pattern") ?? undefined);
    if (!ref) return markerHint();
    if (!(await ref.store.has(ref.name))) throw new PatternNotFoundError(ref.name);
    return watchStream(ref, dir, request);
  }

  if (path === "/api/learn" && request.method === "GET") {
    const dir = url.searchParams.get("dir");
    if (!dir)
      return json({ error: "`dir` is required: the project directory to learn from." }, 400);
    const ref = await resolvePattern(store, dir, url.searchParams.get("pattern") ?? undefined);
    if (!ref) return markerHint();
    if (!(await ref.store.has(ref.name))) throw new PatternNotFoundError(ref.name);
    return learnStream(ref, dir, request);
  }

  if (path === "/api/learn" && request.method === "POST") {
    // The review's outcome: the accepted proposals, written together.
    const body = (await request.json()) as {
      dir?: string;
      pattern?: string;
      accepted?: Proposal[];
    };
    if (!body.dir)
      return json({ error: "`dir` is required: the project directory learned from." }, 400);
    const ref = await resolvePattern(store, body.dir, body.pattern);
    if (!ref) return markerHint();
    const accepted = body.accepted ?? [];
    await saveLearned(ref.store, ref.name, accepted); // UnsafePatternPathError → 400, nothing written
    return json({ pattern: ref.name, written: accepted.length });
  }

  if (path === "/api/learn/draft" && request.method === "POST") {
    // The session's one model call, at review time; with AI off this is an empty list.
    const body = (await request.json()) as {
      dir?: string;
      pattern?: string;
      changed?: string[];
      proposals?: Proposal[];
    };
    if (!body.dir)
      return json({ error: "`dir` is required: the project directory learned from." }, 400);
    const ref = await resolvePattern(store, body.dir, body.pattern);
    if (!ref) return markerHint();
    const doc = await ref.store.load(ref.name);
    const drafted = await draftConventions(doc, body.dir, body.changed ?? [], body.proposals ?? []);
    return json(await learnView(ref, drafted));
  }

  if (path === "/api/export" && request.method === "GET") {
    // The preview: the rendered file, a pure function of the pattern, named
    // outright or read from a directory's marker.
    const dir = url.searchParams.get("dir");
    const target = textTarget(url.searchParams.get("as"));
    if (!target) return json({ error: targetHint() }, 400);
    const ref = await patternOrMarker(store, url.searchParams.get("pattern") ?? undefined, dir);
    if (!ref) return markerHint();
    return json({ pattern: ref.name, ...renderExport(await ref.store.load(ref.name), target) });
  }

  if (path === "/api/export" && request.method === "POST") {
    // The save: the target's own path under the project directory (or `out`,
    // a path the native save dialog chose), 409 when the file is taken.
    const body = (await request.json()) as {
      dir?: string;
      out?: string;
      pattern?: string;
      as?: string;
      force?: boolean;
    };
    const target = EXPORT_TARGETS.find((t) => t === body.as);
    if (!body.dir && !body.out) {
      return json({ error: "`dir` is required: the project to export into." }, 400);
    }
    if (!target)
      return json({ error: `\`as\` must be one of: ${EXPORT_TARGETS.join(", ")}.` }, 400);
    const ref = await patternOrMarker(store, body.pattern, body.dir);
    if (!ref) return markerHint();
    const out =
      body.out ??
      join(
        resolve(body.dir as string),
        target === "bundle"
          ? `${ref.name}.dolly`
          : renderExport(await ref.store.load(ref.name), target).path,
      );
    return json({
      path: await exportPattern(ref.store, ref.name, target, { out, force: body.force }),
    });
  }

  // The three flows the native shell's pickers unlocked (M9). Each binds the
  // verb the CLI binds and answers with what the CLI prints.
  if (path === "/api/extract" && request.method === "POST") {
    // One `dir`, or several `dirs` to keep what they agree on (a name is required then).
    const body = (await request.json()) as {
      dir?: string;
      dirs?: string[];
      name?: string;
      force?: boolean;
    };
    const dirs = body.dirs ?? (body.dir ? [body.dir] : []);
    if (dirs.length === 0)
      return json({ error: "`dir` is required: the project to learn from." }, 400);
    if (dirs.length > 1 && !body.name) {
      return json({ error: "`name` is required when extracting from several projects." }, 400);
    }
    const result =
      dirs.length > 1
        ? await extractFromRepos(dirs, body.name as string)
        : await extractPattern(dirs[0] as string, body.name || undefined);
    const { pattern } = result.document;
    if ((await store.has(pattern.name)) && !body.force) throw new PatternExistsError(pattern.name);
    await saveExtractedPattern(store, result);
    return json({
      name: pattern.name,
      facets: facetNames(pattern),
      captured: Object.keys(result.files).filter((file) => file.startsWith("toolchain/")).length,
    });
  }

  if (path === "/api/new" && request.method === "POST") {
    const body = (await request.json()) as { pattern?: string; dir?: string };
    if (!body.pattern) return json({ error: "`pattern` is required." }, 400);
    if (!body.dir) return json({ error: "`dir` is required: where to scaffold." }, 400);
    const report = await scaffoldProject(store, body.pattern, body.dir);
    return json(report);
  }

  if (path === "/api/link" && request.method === "POST") {
    // `dolly link`: the marker written, the ignore list and rules a marker
    // already there carries kept, the pattern copied into the project with `vendor`.
    const body = (await request.json()) as { dir?: string; pattern?: string; vendor?: boolean };
    if (!body.dir) return json({ error: "`dir` is required: the project directory to link." }, 400);
    if (!body.pattern) return json({ error: "`pattern` is required." }, 400);
    if (!(await store.has(body.pattern))) throw new PatternNotFoundError(body.pattern);
    const linked = await linkProject(body.dir, body.pattern, {
      ...(body.vendor ? { vendorFrom: store } : {}),
    });
    return json({ pattern: body.pattern, ...linked });
  }

  if (path === "/api/ignore" && request.method === "POST") {
    // `dolly ignore`: paths added to the marker's ignore list, the marker returned whole.
    const body = (await request.json()) as { dir?: string; paths?: string[] };
    if (!body.dir) return json({ error: "`dir` is required: the project directory." }, 400);
    if (!body.paths?.length) return json({ error: "`paths` is required: what to ignore." }, 400);
    return json(await ignorePaths(body.dir, body.paths));
  }

  if (path === "/api/import" && request.method === "POST") {
    const body = (await request.json()) as { file?: string; force?: boolean };
    if (!body.file)
      return json(
        { error: "`file` is required: the .dolly bundle to import, a path or an https URL." },
        400,
      );
    const pattern = await importBundle(store, body.file, { force: body.force });
    return json({ name: pattern.name, description: pattern.description });
  }

  return json({ error: `No such route: ${request.method} ${path}` }, 404);
}

/** The targets the preview can render: every one but the bundle, which is bytes. */
function textTarget(raw: string | null | undefined): TextTarget | undefined {
  const target = EXPORT_TARGETS.find((t) => t === raw);
  return target && target !== "bundle" ? target : undefined;
}

function targetHint(): string {
  return `\`as\` must be one of: ${EXPORT_TARGETS.filter((t) => t !== "bundle").join(", ")}.`;
}

async function getPattern(store: PatternStore, name: string): Promise<Response> {
  const source = await readPatternSource(store, name);
  try {
    const doc = parsePatternDocument(source);
    return json({ name, source, pattern: doc.pattern, prose: doc.prose });
  } catch (error) {
    if (!(error instanceof PatternParseError)) throw error;
    // The editor needs broken patterns most, so a parse failure is data.
    return json({ name, source, error: error.message });
  }
}

/** `dolly edit` over HTTP: validate first, then write the author's bytes verbatim. */
async function putPattern(store: PatternStore, name: string, request: Request): Promise<Response> {
  await readPatternSource(store, name); // Editing, not creating: unknown names 404.
  const source = await request.text();
  if (Buffer.byteLength(source) > MAX_PATTERN_BYTES) {
    return json({ error: "That pattern.md is over 1 MiB. Patterns are prose, not payloads." }, 413);
  }
  const doc = parsePatternDocument(source); // PatternParseError → 422, nothing written.
  await writeFile(store.pathOf(name), source);
  return json({ name, pattern: doc.pattern, prose: doc.prose });
}

/** Raw pattern.md source; invalid names throw their own error, not "not found". */
async function readPatternSource(store: PatternStore, name: string): Promise<string> {
  const path = store.pathOf(name);
  try {
    return await readFile(path, "utf8");
  } catch {
    throw new PatternNotFoundError(name);
  }
}

/** An explicit name reads the store; otherwise the directory's marker decides, when there is a directory. */
async function patternOrMarker(
  store: PatternStore,
  explicit: string | undefined,
  dir: string | null | undefined,
): Promise<PatternRef | undefined> {
  if (explicit) return { store, name: explicit };
  return dir ? resolvePattern(store, dir) : undefined;
}

function markerHint(): Response {
  return json(
    { error: "No pattern named and no .dolly marker in that directory. Pass `pattern`." },
    400,
  );
}

/** The wire shape of a proposal: the data, plus the diff the GUI shows for it. */
async function learnView(
  { store, name }: PatternRef,
  proposals: Proposal[],
): Promise<(Proposal & { diff: string })[]> {
  const doc = await store.load(name);
  return Promise.all(
    proposals.map(async (proposal) => ({
      ...proposal,
      diff: await renderProposal(store, doc, proposal),
    })),
  );
}

/**
 * One JSON line per re-learn: the proposals and the files changed so far.
 * The watcher stops when the client goes away.
 */
function learnStream(ref: PatternRef, dir: string, request: Request): Response {
  const { store, name } = ref;
  const encoder = new TextEncoder();
  let stop = (): void => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        } catch {
          stop(); // The stream is gone; stop watching.
        }
      };
      const watcher = watchLearning(
        store,
        name,
        dir,
        (proposals) =>
          learnView(ref, proposals).then(
            (view) => send({ pattern: name, proposals: view, changed: watcher.changed() }),
            (error) => send({ error: error instanceof Error ? error.message : String(error) }),
          ),
        (error) => send({ error: error instanceof Error ? error.message : String(error) }),
      );
      stop = () => watcher.stop();
      request.signal.addEventListener("abort", stop);
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" },
  });
}

/** One JSON report per line, `watchProject` disposed when the client goes away. */
function watchStream({ store, name }: PatternRef, dir: string, request: Request): Response {
  const encoder = new TextEncoder();
  let dispose = (): void => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        } catch {
          dispose(); // The stream is gone; stop watching.
        }
      };
      dispose = watchProject(
        store,
        name,
        dir,
        (report) => send(checkView(name, report)),
        (error) => send({ error: error instanceof Error ? error.message : String(error) }),
      );
      request.signal.addEventListener("abort", dispose);
    },
    cancel() {
      dispose();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" },
  });
}

/**
 * The webview itself: public code, no data, so no token, because the page must be
 * able to load before its script reads the token from the fragment.
 */
async function serveStatic(request: Request, ctx: Context, pathname: string): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: `${request.method} is not supported here.` }, 405);
  }
  if (!ctx.uiAvailable) {
    if (pathname !== "/") return json({ error: "Not found." }, 404);
    return new Response(
      "dolly serve is running (API only: no built GUI found; run `bun run build` in apps/desktop).\n",
      { headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const file = resolve(ctx.uiDir, relative);
  if (file !== ctx.uiDir && !file.startsWith(ctx.uiDir + sep)) {
    return json({ error: "Not found." }, 404); // Traversal is a 404, not a hint.
  }
  const asset = Bun.file(file);
  if (!(await asset.exists())) return json({ error: "Not found." }, 404);
  return new Response(asset);
}

function authorized(request: Request, token: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const presented = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(token);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

function errorResponse(error: unknown): Response {
  // Fit's git preconditions are state conflicts, not bad requests.
  if (error instanceof FitGitError) return json({ error: error.message }, 409);
  if (error instanceof PatternNotFoundError) return json({ error: error.message }, 404);
  if (error instanceof InvalidPatternNameError) return json({ error: error.message }, 400);
  if (error instanceof MarkerError) return json({ error: error.message }, 400);
  if (error instanceof PatternParseError) return json({ error: error.message }, 422);
  // A key the provider refused, or the caller's own mistake: bad requests, in plain words.
  if (error instanceof AiProviderError || error instanceof AiUsageError) {
    return json({ error: error.message }, 400);
  }
  if (error instanceof UnsafePatternPathError) return json({ error: error.message }, 400);
  // Something already there: the caller decides whether to replace it.
  if (
    error instanceof ExportExistsError ||
    error instanceof PatternExistsError ||
    error instanceof TargetNotEmptyError
  ) {
    return json({ error: error.message }, 409);
  }
  if (error instanceof InvalidBundleError) return json({ error: error.message }, 400);
  if (error instanceof SyntaxError)
    return json({ error: "The request body is not valid JSON." }, 400);
  return json({ error: error instanceof Error ? error.message : String(error) }, 500);
}

function json(payload: unknown, status = 200): Response {
  return new Response(`${JSON.stringify(payload)}\n`, {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
