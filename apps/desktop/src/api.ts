/**
 * The typed client for `dolly serve`'s /api (docs/design/gui.md). The token
 * arrives once in the printed URL's fragment, moves into this tab's session,
 * and rides every request as a bearer header, never a cookie.
 */

const TOKEN_KEY = "dolly:token";

export interface PatternSummary {
  name: string;
  description: string;
  /** Set when pattern.md exists but does not parse: flagged, never hidden. */
  error?: string;
}

/** The facet frontmatter, loosely mirrored from @dollysheep/core's schema. */
export interface Pattern {
  name: string;
  description?: string;
  license?: string;
  languages?: { programming?: string[]; versions?: Record<string, string>; natural?: string };
  naming?: { files?: string; directories?: string; extensions?: Record<string, string> };
  layout?: { path: string; required?: boolean; description?: string }[];
  toolchain?: {
    packageManager?: string;
    formatter?: string;
    linter?: string;
    typechecker?: string;
    testRunner?: string;
    taskRunner?: string;
    ci?: string;
    hooks?: string;
    binding?: Record<string, string>;
    configs?: Record<string, string>;
  };
  testing?: { placement?: string; filePattern?: string };
  commands?: Record<string, string>;
  dependencies?: {
    runtime?: Record<string, string>;
    dev?: Record<string, string>;
    versionPolicy?: string;
  };
  scaffold?: { templates?: string[] };
  commits?: { style: string; types?: string[]; scope?: string; subject?: string };
  releases?: { versioning?: string; changelog?: string; tool?: string };
}

export interface PatternDetail {
  name: string;
  /** The raw pattern.md, the editor's ground truth. */
  source: string;
  pattern?: Pattern;
  prose?: string;
  /** Set when the source does not parse, which is the editor's cue to open. */
  error?: string;
}

/** Every rule, in the engine's reporting order: what the marker's `rules` may name. */
export const RULE_IDS = [
  "layout",
  "naming",
  "config",
  "commands",
  "license",
  "testing",
  "hooks",
  "env",
  "languages",
  "releases",
] as const;

export type RuleSetting = "off" | "warn";

/** The `.dolly` marker: the pattern, where it lives, and the project's own word on the rules. */
export interface Marker {
  pattern: string;
  source?: string;
  sha256?: string;
  ignore: string[];
  rules: Partial<Record<(typeof RULE_IDS)[number], RuleSetting>>;
}

export interface CheckViolation {
  rule: string;
  path: string;
  message: string;
  fixable: boolean;
  /** Present when the marker's `rules` turned the rule down: reported, never counted. */
  severity?: "warning";
}

/** One line of the model's reading of the prose conventions. */
export interface ConventionFinding {
  path: string;
  line?: number;
  message: string;
}

export interface CheckReport {
  pattern: string;
  violations: CheckViolation[];
  fixed: string[];
  diagnostics: string[];
  /** Violations the marker's ignore list and rule settings set aside. */
  ignored: number;
  /** Under the Conventions toggle: the model, its findings, and the files the bounds left out. */
  conventions?: { model: string; findings: ConventionFinding[]; skipped: string[] };
}

/** A fix as data, mirrored from @dollysheep/core's FixPlan. */
export interface FitFixPlan {
  kind: "create" | "write" | "append" | "merge";
  path: string;
}

export interface FitRewrite {
  file: string;
  from: string;
  to: string;
}

export type FitStep =
  | { kind: "fix"; path: string; reason: string; plan: FitFixPlan; preview: string }
  | { kind: "move"; rule: string; from: string; to: string; reason: string; rewrites: FitRewrite[] }
  | {
      kind: "translate";
      from: string;
      to: string;
      language: string;
      reason: string;
      bytes: number;
    };

export interface FitReport {
  pattern: string;
  /** Whether --apply's precondition holds; "clean" is the only green light. */
  git: "missing" | "dirty" | "clean";
  steps: FitStep[];
  declined: {
    path: string;
    message: string;
    /** Attached by the AI layer when it is on; a labeled pick, never a step. */
    suggestion?: { pick: string; why: string; model: string };
    /** Why the AI layer could not suggest, when it tried. */
    aiError?: string;
  }[];
  diagnostics: string[];
  /** Present after an apply. */
  checkpoint?: string;
  committed?: boolean;
  applied?: string[];
  verified?: string[];
  failures?: string[];
  /** The pattern's typecheck and test commands, present when the plan holds translations: Apply runs them as written. */
  verification?: { typecheck?: string; test?: string };
}

/** A pattern edit learn proposes, mirrored from @dollysheep/core's Proposal, plus the diff the daemon renders for it. */
export interface Proposal {
  /** Facet path as segments; ["layout"] appends an entry, ["prose"] a convention line. */
  path: string[];
  value: unknown;
  before?: unknown;
  reason: string;
  /** Captured config bytes written into the pattern on accept. */
  files?: Record<string, string>;
  diff: string;
}

export interface LearnReport {
  /** The pattern learn resolved, from the marker or by name. */
  pattern: string;
  proposals: Proposal[];
  /** Project files that changed since watching began. */
  changed: string[];
}

/** `dolly ai status` over the wire: null provider means the layer is off. */
export interface AiStatus {
  provider: "anthropic" | "openai" | "google" | null;
  model: string | null;
  /** "missing" when a provider is selected but no key can be found for it. */
  keySource: "environment" | "keychain" | "missing" | null;
}

/** A provider as the settings view lists it. */
export interface AiProviderStatus {
  id: "anthropic" | "openai" | "google";
  label: string;
  defaultModel: string;
  keySource: "environment" | "keychain" | "missing";
  envVar: string;
}

/** What `dolly new` wrote, project-relative, plus what it has to say. */
export interface ScaffoldReport {
  root: string;
  projectName: string;
  created: string[];
  skipped: string[];
  notes: string[];
  nextSteps: string[];
}

/** One export target as the daemon renders it: the file, where its reader expects it, and the pattern it came from. */
export interface RenderedExport {
  pattern: string;
  target: string;
  path: string;
  contents: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Move the token from the printed URL's fragment into this tab's session. */
export function adoptToken(): void {
  const params = new URLSearchParams(location.hash.replace(/^#\/?/, ""));
  const token = params.get("token");
  if (token) {
    sessionStorage.setItem(TOKEN_KEY, token);
    history.replaceState(null, "", "#/"); // the fragment carries routes from here on
  }
}

export function hasToken(): boolean {
  return sessionStorage.getItem(TOKEN_KEY) !== null;
}

function authHeader(): Record<string, string> {
  return { authorization: `Bearer ${sessionStorage.getItem(TOKEN_KEY) ?? ""}` };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { ...authHeader(), ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      message = ((await response.json()) as { error?: string }).error ?? message;
    } catch {
      // A non-JSON error body keeps the status line as the message.
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

export const api = {
  health: () => request<{ name: string; version: string; home: string }>("/api/health"),
  ai: () => request<AiStatus>("/api/ai"),
  aiProviders: () => request<AiProviderStatus[]>("/api/ai/providers"),
  /** `dolly ai connect`: the key is verified live before the keychain stores it. */
  aiConnect: (provider: string, key: string) =>
    request<AiStatus>("/api/ai/connect", {
      method: "POST",
      body: JSON.stringify({ provider, key }),
    }),
  aiUse: (provider: string, model?: string) =>
    request<AiStatus>("/api/ai/use", { method: "POST", body: JSON.stringify({ provider, model }) }),
  aiOff: () => request<AiStatus>("/api/ai/off", { method: "POST" }),
  /** The export preview: a pure function of the pattern, so it is safe to fetch on every change. */
  exportPreview: (dir: string, pattern: string | undefined, as: string) => {
    const params = streamParams(dir, pattern);
    params.set("as", as);
    return request<RenderedExport>(`/api/export?${params}`);
  },
  /** `dolly extract` over the wire: one project, or several to keep what they agree on. */
  extract: (dirs: string[], name: string | undefined, force?: boolean) =>
    request<{ name: string; facets: string[]; captured: number }>("/api/extract", {
      method: "POST",
      body: JSON.stringify({
        ...(dirs.length === 1 ? { dir: dirs[0] } : { dirs }),
        name: name || undefined,
        force,
      }),
    }),
  /** `dolly link`: the marker written, the pattern copied into the project with `vendor`. */
  link: (dir: string, pattern: string, vendor?: boolean) =>
    request<{ pattern: string; replaced?: string; vendored?: string }>("/api/link", {
      method: "POST",
      body: JSON.stringify({ dir, pattern, vendor }),
    }),
  /** `dolly ignore`: paths added to the marker's ignore list. */
  ignore: (dir: string, paths: string[]) =>
    request<{ pattern: string; ignore: string[] }>("/api/ignore", {
      method: "POST",
      body: JSON.stringify({ dir, paths }),
    }),
  /** The project's marker as data; a directory without one is a 404. */
  marker: (dir: string) => request<Marker>(`/api/marker?dir=${encodeURIComponent(dir)}`),
  /** `dolly ignore --remove` and `dolly rules`: the ignore list or the rules replaced whole. */
  editMarker: (dir: string, edit: { ignore?: string[]; rules?: Marker["rules"] }) =>
    request<Marker>("/api/marker", { method: "POST", body: JSON.stringify({ dir, ...edit }) }),
  /** A pattern's captured files (configs and templates), pattern-relative. */
  listPatternFiles: (name: string) =>
    request<string[]>(`/api/patterns/${encodeURIComponent(name)}/files`),
  getPatternFile: (name: string, path: string) =>
    request<{ path: string; contents: string }>(patternFileUrl(name, path)),
  /** The author's own bytes, written as they are. */
  savePatternFile: (name: string, path: string, contents: string) =>
    request<{ path: string }>(patternFileUrl(name, path), { method: "PUT", body: contents }),
  /** `dolly new`: the scaffold report; a directory that is not empty is a 409. */
  scaffold: (pattern: string, dir: string) =>
    request<ScaffoldReport>("/api/new", { method: "POST", body: JSON.stringify({ pattern, dir }) }),
  /** `dolly import`: the pattern the bundle held; one that exists already is a 409 until `force`. */
  importBundle: (file: string, force?: boolean) =>
    request<{ name: string; description: string }>("/api/import", {
      method: "POST",
      body: JSON.stringify({ file, force }),
    }),
  /** The bundle, written where the native save dialog chose (which already asked about overwriting). */
  exportBundle: (pattern: string, out: string) =>
    request<{ path: string }>("/api/export", {
      method: "POST",
      body: JSON.stringify({ pattern, as: "bundle", out, force: true }),
    }),
  /** Writes the export at its own path under the project; 409 when the file exists and `force` is not set. */
  exportSave: (dir: string, pattern: string | undefined, as: string, force?: boolean) =>
    request<{ path: string }>("/api/export", {
      method: "POST",
      body: JSON.stringify({ dir, pattern: pattern || undefined, as, force }),
    }),
  listPatterns: () => request<PatternSummary[]>("/api/patterns"),
  getPattern: (name: string) => request<PatternDetail>(`/api/patterns/${encodeURIComponent(name)}`),
  /** `dolly edit` over HTTP: the body is the raw source, written verbatim when valid. */
  savePattern: (name: string, source: string) =>
    request<PatternDetail>(`/api/patterns/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: source,
    }),
  deletePattern: (name: string) =>
    request<{ deleted: string }>(`/api/patterns/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
  check: (dir: string, options: { pattern?: string; fix?: boolean; conventions?: boolean } = {}) =>
    request<CheckReport>("/api/check", {
      method: "POST",
      body: JSON.stringify({ dir, ...options }),
    }),
  fit: (dir: string, options: { pattern?: string; apply?: boolean } = {}) =>
    request<FitReport>("/api/fit", {
      method: "POST",
      body: JSON.stringify({ dir, ...options }),
    }),
  /** The review's outcome: the accepted proposals, written together. */
  learnWrite: (dir: string, pattern: string | undefined, accepted: Proposal[]) =>
    request<{ pattern: string; written: number }>("/api/learn", {
      method: "POST",
      body: JSON.stringify({ dir, pattern, accepted }),
    }),
  /** The session's one model call; an empty list with AI off. */
  learnDraft: (
    dir: string,
    pattern: string | undefined,
    changed: string[],
    proposals: Proposal[],
  ) =>
    request<Proposal[]>("/api/learn/draft", {
      method: "POST",
      body: JSON.stringify({ dir, pattern, changed, proposals }),
    }),
};

/**
 * Holds one of the daemon's NDJSON streams open, reporting each line as it
 * lands. Returns a disposer; disposing also stops the server-side watcher.
 */
function streamLines<T>(
  path: string,
  params: URLSearchParams,
  onLine: (line: T) => void,
  onError: (message: string) => void,
): () => void {
  const aborter = new AbortController();
  void (async () => {
    try {
      const response = await fetch(`${path}?${params}`, {
        headers: authHeader(),
        signal: aborter.signal,
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new ApiError(response.status, body.error ?? response.statusText);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut = buffer.indexOf("\n");
        while (cut !== -1) {
          const line = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 1);
          const payload = JSON.parse(line) as T | { error: string };
          if ("error" in (payload as object)) onError((payload as { error: string }).error);
          else onLine(payload as T);
          cut = buffer.indexOf("\n");
        }
      }
    } catch (cause) {
      if (aborter.signal.aborted) return; // disposed on purpose
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  })();
  return () => aborter.abort();
}

function patternFileUrl(name: string, path: string): string {
  const rel = path.split("/").map(encodeURIComponent).join("/");
  return `/api/patterns/${encodeURIComponent(name)}/files/${rel}`;
}

function streamParams(dir: string, pattern: string | undefined): URLSearchParams {
  const params = new URLSearchParams({ dir });
  if (pattern) params.set("pattern", pattern);
  return params;
}

/** Check's watch: one report per change. */
export function watchChecks(
  dir: string,
  pattern: string | undefined,
  onReport: (report: CheckReport) => void,
  onError: (message: string) => void,
): () => void {
  return streamLines("/api/watch", streamParams(dir, pattern), onReport, onError);
}

/** Learn's watch: the proposals and the changed files, re-learned on every change. */
export function watchLearning(
  dir: string,
  pattern: string | undefined,
  onReport: (report: LearnReport) => void,
  onError: (message: string) => void,
): () => void {
  return streamLines("/api/learn", streamParams(dir, pattern), onReport, onError);
}
