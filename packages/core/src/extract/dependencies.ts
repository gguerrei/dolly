import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import type { Dependencies, Toolchain } from "../pattern/schema";
import { readIfExists, readJsonSafe } from "../tree/files";
import type { Inventory } from "../tree/inventory";
import { expandGlobs } from "./globs";
import { DEV_PURPOSES, type Ecosystem, type Purpose, REGISTRY } from "./registry";

/**
 * Reads dependency manifests (root + declared workspace members only) and
 * emits purpose→library facets filtered through the registry, plus a
 * versionPolicy voted from specifier shapes. Tool identity mirrors the
 * toolchain facet's winners, so the two facets can never disagree.
 */
export const DEPENDENCIES_TUNING = {
  /** versionPolicy needs at least this many votes… */
  minPolicyVotes: 3,
  /** …and a ≥ 2/3 supermajority. */
  policyRatio: [2, 3] as const,
  /** Unknown-dep prose notes list at most this many names. */
  maxListed: 20,
};

/** Groups in [project.optional-dependencies] that mean "dev", not "feature flag". */
const DEV_GROUPS = new Set([
  "dev",
  "test",
  "tests",
  "testing",
  "lint",
  "docs",
  "doc",
  "typing",
  "types",
  "ci",
  "coverage",
]);

/** Toolchain winners that are not installable libraries: runtime builtins and build plugins. */
const BUILTIN_TOOLS = new Set([
  "rustfmt",
  "gofmt",
  "bun-test",
  "node-test",
  "dotnet-format",
  "checkstyle",
  "detekt",
  "junit",
]);

type Policy = "pinned" | "caret" | "latest";
const UNVOTABLE = Symbol("unvotable");

interface Dep {
  ecosystem: Ecosystem;
  name: string;
  bucket: "runtime" | "dev";
  shape: Policy | typeof UNVOTABLE;
}

export interface DependenciesScan {
  dependencies?: Dependencies;
  notes: string[];
}

export async function scanDependencies(
  inventory: Inventory,
  toolchain?: Toolchain,
  /** The repo's one primary ecosystem, shared with toolchain so the two facets cannot disagree. */
  primaryEcosystem?: Ecosystem,
): Promise<DependenciesScan> {
  const notes: string[] = [];
  const deps: Dep[] = [];

  await parseNpm(inventory, deps, notes);
  await parsePypi(inventory, deps, notes);
  await parseCargo(inventory, deps, notes);
  await parseGo(inventory, deps);
  await parseRubygems(inventory, deps);
  await parseMaven(inventory, deps, notes);
  await parseComposer(inventory, deps, notes);
  await parseNuget(inventory, deps, notes);

  // Merge per (ecosystem, name): runtime wins over dev; one modal shape vote each.
  const merged = new Map<
    string,
    { ecosystem: Ecosystem; name: string; bucket: "runtime" | "dev"; shapes: Policy[] }
  >();
  for (const dep of deps) {
    const key = `${dep.ecosystem}\0${dep.name}`;
    const existing = merged.get(key) ?? {
      ecosystem: dep.ecosystem,
      name: dep.name,
      bucket: dep.bucket,
      shapes: [],
    };
    if (dep.bucket === "runtime") existing.bucket = "runtime";
    if (dep.shape !== UNVOTABLE) existing.shapes.push(dep.shape);
    merged.set(key, existing);
  }

  // Purpose classification per ecosystem; a purpose held by two known deps is a conflict.
  const perEcosystem = new Map<
    Ecosystem,
    {
      purposes: Map<Purpose, string[]>;
      bucketOf: Map<Purpose, "runtime" | "dev">;
      unknown: Map<"runtime" | "dev", string[]>;
      count: number;
    }
  >();
  for (const dep of merged.values()) {
    let eco = perEcosystem.get(dep.ecosystem);
    if (!eco) {
      eco = { purposes: new Map(), bucketOf: new Map(), unknown: new Map(), count: 0 };
      perEcosystem.set(dep.ecosystem, eco);
    }
    const purpose = REGISTRY[dep.ecosystem][normalizeForLookup(dep.ecosystem, dep.name)];
    if (purpose) {
      const holders = eco.purposes.get(purpose) ?? [];
      holders.push(dep.name);
      eco.purposes.set(purpose, holders);
      eco.bucketOf.set(purpose, DEV_PURPOSES.has(purpose) ? "dev" : dep.bucket);
      eco.count++;
    } else {
      const list = eco.unknown.get(dep.bucket) ?? [];
      list.push(dep.name);
      eco.unknown.set(dep.bucket, list);
    }
  }

  if (merged.size === 0 && !toolchain) return { dependencies: undefined, notes };

  // The primary ecosystem gets the facets; secondaries degrade to one note
  // each. The language-derived primary wins when it has deps at all, so this
  // facet and toolchain's read the same repo the same way.
  const ranked = [...perEcosystem.entries()].sort(
    ([an, a], [bn, b]) => b.count - a.count || (an < bn ? -1 : 1),
  );
  const primary =
    primaryEcosystem && perEcosystem.has(primaryEcosystem) ? primaryEcosystem : ranked[0]?.[0];
  const runtime: Record<string, string> = {};
  const dev: Record<string, string> = {};

  const facetOf = (
    eco: NonNullable<ReturnType<typeof perEcosystem.get>>,
  ): { purpose: Purpose; name: string; bucket: "runtime" | "dev" }[] => {
    const rows: { purpose: Purpose; name: string; bucket: "runtime" | "dev" }[] = [];
    for (const [purpose, holders] of [...eco.purposes.entries()].sort(([a], [b]) =>
      a < b ? -1 : 1,
    )) {
      if (holders.length === 1)
        rows.push({
          purpose,
          name: holders[0] as string,
          bucket: eco.bucketOf.get(purpose) ?? "runtime",
        });
      else
        notes.push(
          `Both ${holders.sort().join(" and ")} are present (purpose: ${purpose}); no facet emitted. Keep one and add it by hand.`,
        );
    }
    return rows;
  };

  if (primary) {
    const eco = perEcosystem.get(primary) as NonNullable<ReturnType<typeof perEcosystem.get>>;
    for (const row of facetOf(eco))
      (row.bucket === "runtime" ? runtime : dev)[row.purpose] = row.name;
    for (const bucket of ["runtime", "dev"] as const) {
      const unknown = (eco.unknown.get(bucket) ?? []).sort();
      if (unknown.length > 0) {
        const listed = unknown.slice(0, DEPENDENCIES_TUNING.maxListed).join(", ");
        const more =
          unknown.length > DEPENDENCIES_TUNING.maxListed
            ? ` and ${unknown.length - DEPENDENCIES_TUNING.maxListed} more`
            : "";
        notes.push(
          `Unclassified ${bucket} dependencies (${primary}): ${listed}${more}. Add any that are part of your pattern to the dependencies facet with a purpose key.`,
        );
      }
    }
    for (const [name, eco2] of ranked.slice(1)) {
      const rows = facetOf(eco2).map((r) => `${r.purpose}: ${r.name}`);
      if (rows.length > 0)
        notes.push(
          `${name} (secondary ecosystem): ${rows.join(", ")}. Promote by hand if wanted (e.g. "${name}/test" keys).`,
        );
    }
  }

  // Tool identity mirrors toolchain's resolved winners (single ownership).
  for (const [role, purpose] of [
    ["formatter", "format"],
    ["linter", "lint"],
    ["typechecker", "typecheck"],
    ["testRunner", "test"],
  ] as const) {
    const tool = toolchain?.[role];
    if (tool && !BUILTIN_TOOLS.has(tool)) dev[purpose] = tool;
  }

  // versionPolicy: one modal-shape vote per dep, then a supermajority overall.
  const tally: Record<Policy, number> = { pinned: 0, caret: 0, latest: 0 };
  for (const dep of merged.values()) {
    const modal = modalShape(dep.shapes);
    if (modal) tally[modal]++;
  }
  const total = tally.pinned + tally.caret + tally.latest;
  const winner = (["pinned", "caret", "latest"] as const).reduce((a, b) =>
    tally[b] > tally[a] ? b : a,
  );
  const [num, den] = DEPENDENCIES_TUNING.policyRatio;
  let versionPolicy: Policy | undefined;
  if (total >= DEPENDENCIES_TUNING.minPolicyVotes && tally[winner] * den >= total * num) {
    versionPolicy = winner;
  } else if (total >= DEPENDENCIES_TUNING.minPolicyVotes) {
    notes.push(
      `Version specifiers are mixed (${tally.pinned} pinned, ${tally.caret} caret, ${tally.latest} latest); versionPolicy omitted.`,
    );
  }

  const hasFacet =
    Object.keys(runtime).length > 0 || Object.keys(dev).length > 0 || versionPolicy !== undefined;
  return {
    dependencies: hasFacet
      ? { runtime, dev, ...(versionPolicy ? { versionPolicy } : {}) }
      : undefined,
    notes,
  };
}

function modalShape(shapes: Policy[]): Policy | undefined {
  if (shapes.length === 0) return undefined;
  const counts: Record<Policy, number> = { pinned: 0, caret: 0, latest: 0 };
  for (const shape of shapes) counts[shape]++;
  // Ties break conservative: pinned > caret > latest.
  return (["pinned", "caret", "latest"] as const).reduce((a, b) => (counts[b] > counts[a] ? b : a));
}

function normalizeForLookup(ecosystem: Ecosystem, name: string): string {
  if (ecosystem === "pypi") return name.toLowerCase().replace(/[-_.]+/g, "-");
  if (ecosystem === "go") return name.replace(/\/v\d+$/, "");
  // Composer and NuGet ids are case-insensitive; the registry keeps them lower.
  if (ecosystem === "composer" || ecosystem === "nuget") return name.toLowerCase();
  return name;
}

// --- npm ---------------------------------------------------------------

async function parseNpm(inventory: Inventory, deps: Dep[], notes: string[]): Promise<void> {
  const path = join(inventory.root, "package.json");
  if (!(await Bun.file(path).exists())) return;
  const root = await readJsonSafe(path);
  if (!root) {
    notes.push("package.json could not be parsed; npm dependencies not extracted.");
    return;
  }

  const manifests: Record<string, unknown>[] = [root];
  const internal = new Set<string>();
  const catalogs = await pnpmCatalogs(inventory);

  const workspaceGlobs = Array.isArray(root.workspaces)
    ? (root.workspaces as string[])
    : ((root.workspaces as { packages?: string[] } | undefined)?.packages ??
      (await pnpmWorkspaceGlobs(inventory)));
  for (const dir of expandGlobs(workspaceGlobs ?? [], inventory.dirs)) {
    const member = await readJsonSafe(join(inventory.root, dir, "package.json"));
    if (member) manifests.push(member);
  }
  for (const manifest of manifests)
    if (typeof manifest.name === "string") internal.add(manifest.name);

  for (const manifest of manifests) {
    for (const [section, bucket] of [
      ["dependencies", "runtime"],
      ["peerDependencies", "runtime"],
      ["optionalDependencies", "runtime"],
      ["devDependencies", "dev"],
    ] as const) {
      for (let [name, spec] of Object.entries(
        (manifest[section] as Record<string, string> | undefined) ?? {},
      )) {
        if (typeof spec !== "string") continue;
        const alias = spec.match(/^npm:(@?[^@]+)@(.+)$/);
        if (alias) [, name, spec] = alias as unknown as [string, string, string];
        if (spec.startsWith("catalog:"))
          spec = catalogs.get(`${spec.slice("catalog:".length) || "default"}\0${name}`) ?? "";
        if (internal.has(name) || /^(workspace|file|link|portal):/.test(spec)) continue;
        const shape = /^(git|github:|https?:)/.test(spec) ? UNVOTABLE : npmShape(spec);
        deps.push({ ecosystem: "npm", name, bucket, shape });
      }
    }
  }
}

function npmShape(spec: string): Policy | typeof UNVOTABLE {
  const s = spec.trim();
  if (s === "" || s === "*" || s === "latest") return "latest";
  if (/^=?\d+\.\d+\.\d+([-+][\w.-]+)?$/.test(s)) return "pinned";
  if (/^[\^~]/.test(s) || /^\d+(\.\d+)?\.x$/i.test(s) || s.includes(" - ")) return "caret";
  if (/[<>]/.test(s)) return /[<]/.test(s) ? "caret" : "latest";
  return UNVOTABLE;
}

async function pnpmWorkspaceGlobs(inventory: Inventory): Promise<string[] | undefined> {
  const text = await readIfExists(join(inventory.root, "pnpm-workspace.yaml"));
  if (!text) return undefined;
  try {
    return (parseYaml(text) as { packages?: string[] })?.packages;
  } catch {
    return undefined;
  }
}

async function pnpmCatalogs(inventory: Inventory): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const text = await readIfExists(join(inventory.root, "pnpm-workspace.yaml"));
  if (!text) return map;
  try {
    const parsed = parseYaml(text) as {
      catalog?: Record<string, string>;
      catalogs?: Record<string, Record<string, string>>;
    };
    for (const [name, spec] of Object.entries(parsed?.catalog ?? {}))
      map.set(`default\0${name}`, spec);
    for (const [catalog, entries] of Object.entries(parsed?.catalogs ?? {})) {
      for (const [name, spec] of Object.entries(entries)) map.set(`${catalog}\0${name}`, spec);
    }
  } catch {
    // An unparseable workspace file only loses catalog resolution.
  }
  return map;
}

// --- pypi --------------------------------------------------------------

async function parsePypi(inventory: Inventory, deps: Dep[], notes: string[]): Promise<void> {
  const pyprojectText = await readIfExists(join(inventory.root, "pyproject.toml"));
  let declared = false;

  if (pyprojectText !== undefined) {
    let pyproject: Record<string, unknown>;
    try {
      pyproject = parseToml(pyprojectText) as Record<string, unknown>;
    } catch {
      notes.push("pyproject.toml could not be parsed; Python dependencies not extracted from it.");
      return;
    }
    const project = pyproject.project as Record<string, unknown> | undefined;
    const groups = pyproject["dependency-groups"] as Record<string, unknown> | undefined;

    for (const line of (project?.dependencies as string[] | undefined) ?? []) {
      addPep508(deps, line, "runtime");
      declared = true;
    }
    for (const lines of Object.values(groups ?? {})) {
      for (const line of lines as unknown[])
        if (typeof line === "string") addPep508(deps, line, "dev");
      declared = true;
    }
    for (const [group, lines] of Object.entries(
      (project?.["optional-dependencies"] as Record<string, string[]> | undefined) ?? {},
    )) {
      const normalized = group.toLowerCase().replace(/[-_.]+/g, "-");
      if (DEV_GROUPS.has(normalized)) {
        for (const line of lines) addPep508(deps, line, "dev");
        declared = true;
      } else {
        notes.push(
          `Optional dependency group "${group}" looks like a feature flag, not dev tooling, so it was skipped.`,
        );
      }
    }
    if (!declared) {
      const poetry = (pyproject.tool as Record<string, unknown> | undefined)?.poetry as
        | Record<string, unknown>
        | undefined;
      for (const [name, spec] of Object.entries(
        (poetry?.dependencies as Record<string, unknown> | undefined) ?? {},
      )) {
        if (name.toLowerCase() === "python") continue;
        addPoetry(deps, name, spec, "runtime");
        declared = true;
      }
      for (const group of Object.values(
        (poetry?.group as Record<string, { dependencies?: Record<string, unknown> }> | undefined) ??
          {},
      )) {
        for (const [name, spec] of Object.entries(group.dependencies ?? {}))
          addPoetry(deps, name, spec, "dev");
        declared = true;
      }
    }
  }

  let fromRequirements = false;
  for (const file of ["requirements.in", "requirements.txt"]) {
    const path = join(inventory.root, file);
    if (!(await Bun.file(path).exists())) continue;
    if (declared) {
      notes.push(`${file} is shadowed by pyproject.toml's declared dependencies.`);
      break;
    }
    await parseRequirements(path, deps, new Set(), "runtime");
    declared = fromRequirements = true;
    break; // requirements.in outranks requirements.txt; parse one source only.
  }
  for (const devFile of ["requirements-dev.txt", "dev-requirements.txt", "requirements/dev.txt"]) {
    const path = join(inventory.root, devFile);
    if (!fromRequirements || !(await Bun.file(path).exists())) continue;
    await parseRequirements(path, deps, new Set(), "dev");
  }
  if (!declared && (await Bun.file(join(inventory.root, "setup.py")).exists())) {
    notes.push("setup.py found; its dependencies are code, not data, and were not extracted.");
  }
}

function addPep508(deps: Dep[], line: string, bucket: "runtime" | "dev"): void {
  const cut = (line.split(";")[0] ?? "").trim();
  const match = cut.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*(.*)$/);
  if (!match) return;
  const name = (match[1] as string).toLowerCase().replace(/[-_.]+/g, "-");
  deps.push({ ecosystem: "pypi", name, bucket, shape: pypiShape((match[3] ?? "").trim()) });
}

function addPoetry(deps: Dep[], name: string, spec: unknown, bucket: "runtime" | "dev"): void {
  const normalized = name.toLowerCase().replace(/[-_.]+/g, "-");
  const version = typeof spec === "string" ? spec : ((spec as { version?: string })?.version ?? "");
  const shape =
    typeof spec === "object" && spec !== null && !(spec as { version?: string }).version
      ? UNVOTABLE
      : poetryShape(version);
  deps.push({ ecosystem: "pypi", name: normalized, bucket, shape });
}

function pypiShape(spec: string): Policy | typeof UNVOTABLE {
  if (spec === "") return "latest";
  if (spec.startsWith("==")) return "pinned";
  if (spec.startsWith("~=")) return "caret";
  if (/>=?/.test(spec)) return spec.includes("<") ? "caret" : "latest";
  return UNVOTABLE;
}

function poetryShape(spec: string): Policy | typeof UNVOTABLE {
  if (spec === "" || spec === "*") return "latest";
  if (/^[\^~]/.test(spec)) return "caret";
  if (/^=?\d/.test(spec)) return "pinned";
  return pypiShape(spec);
}

async function parseRequirements(
  absPath: string,
  deps: Dep[],
  seen: Set<string>,
  bucket: "runtime" | "dev",
): Promise<void> {
  if (seen.has(absPath)) return;
  seen.add(absPath);
  const text = await readIfExists(absPath);
  if (text === undefined) return;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("-r ") || line.startsWith("--requirement ")) {
      const target = line.split(/\s+/)[1];
      if (target) await parseRequirements(join(absPath, "..", target), deps, seen, bucket);
      continue;
    }
    if (line.startsWith("-") || /^https?:/.test(line)) continue;
    addPep508(deps, line, bucket);
  }
}

// --- cargo -------------------------------------------------------------

async function parseCargo(inventory: Inventory, deps: Dep[], notes: string[]): Promise<void> {
  const rootText = await readIfExists(join(inventory.root, "Cargo.toml"));
  if (rootText === undefined) return;
  let root: Record<string, unknown>;
  try {
    root = parseToml(rootText) as Record<string, unknown>;
  } catch {
    notes.push("Cargo.toml could not be parsed; Rust dependencies not extracted.");
    return;
  }

  const workspace = root.workspace as
    | { members?: string[]; exclude?: string[]; dependencies?: Record<string, unknown> }
    | undefined;
  const workspaceDeps = workspace?.dependencies ?? {};
  const manifests: Record<string, unknown>[] = [root];
  const excluded = new Set(workspace?.exclude ?? []);
  for (const dir of expandGlobs(workspace?.members ?? [], inventory.dirs)) {
    if (excluded.has(dir)) continue;
    const text = await readIfExists(join(inventory.root, dir, "Cargo.toml"));
    if (text === undefined) continue;
    try {
      manifests.push(parseToml(text) as Record<string, unknown>);
    } catch {
      notes.push(`${dir}/Cargo.toml could not be parsed; skipped.`);
    }
  }

  const internal = new Set<string>();
  for (const manifest of manifests) {
    const pkg = manifest.package as { name?: string } | undefined;
    if (pkg?.name) internal.add(pkg.name);
  }

  for (const manifest of manifests) {
    for (const [section, bucket] of [
      ["dependencies", "runtime"],
      ["dev-dependencies", "dev"],
      ["build-dependencies", "dev"],
    ] as const) {
      for (const [name, spec] of Object.entries(
        (manifest[section] as Record<string, unknown> | undefined) ?? {},
      )) {
        if (internal.has(name)) continue;
        deps.push({
          ecosystem: "cargo",
          name,
          bucket,
          shape: cargoShape(name, spec, workspaceDeps),
        });
      }
    }
  }
}

function cargoShape(
  name: string,
  spec: unknown,
  workspaceDeps: Record<string, unknown>,
): Policy | typeof UNVOTABLE {
  if (typeof spec === "string") {
    if (spec === "*") return "latest";
    if (spec.startsWith("=")) return "pinned";
    if (/^[\^~]?\d/.test(spec)) return "caret"; // bare cargo versions ARE caret semantics
    return UNVOTABLE;
  }
  const table = spec as {
    version?: string;
    workspace?: boolean;
    path?: string;
    git?: string;
  } | null;
  if (!table) return UNVOTABLE;
  if (table.workspace)
    return name in workspaceDeps ? cargoShape(name, workspaceDeps[name], {}) : UNVOTABLE;
  if (table.path || table.git) return UNVOTABLE;
  return table.version ? cargoShape(name, table.version, {}) : UNVOTABLE;
}

// --- go ----------------------------------------------------------------

async function parseGo(inventory: Inventory, deps: Dep[]): Promise<void> {
  const work = await readIfExists(join(inventory.root, "go.work"));
  const modFiles: string[] = [];
  if (work !== undefined) {
    for (const match of work.matchAll(/^use\s+(?:\(\s*)?([./\w-]+)/gm)) {
      const dir = (match[1] as string).replace(/^\.\//, "");
      modFiles.push(join(inventory.root, dir, "go.mod"));
    }
  } else {
    modFiles.push(join(inventory.root, "go.mod"));
  }

  for (const modFile of modFiles) {
    const text = await readIfExists(modFile);
    if (text === undefined) continue;
    const internal = new Set<string>();
    for (const match of text.matchAll(/^replace\s+(\S+)\s*=>\s*(\.\.?\/\S*)/gm))
      internal.add(match[1] as string);
    const requireBlocks = [...text.matchAll(/^require\s+\(([\s\S]*?)\)/gm)].map(
      (m) => m[1] as string,
    );
    const singles = [...text.matchAll(/^require\s+([^\s(]+)\s+(\S+).*$/gm)].map(
      (m) => `${m[1]} ${m[2]}`,
    );
    const lines = requireBlocks.flatMap((block) => block.split("\n")).concat(singles);
    for (const raw of lines) {
      const line = raw.trim();
      if (line === "" || line.endsWith("// indirect")) continue;
      const [name] = line.split(/\s+/);
      if (!name || internal.has(name)) continue;
      // Go offers no specifier-shape choice, so go.mod abstains from the policy vote.
      deps.push({ ecosystem: "go", name, bucket: "runtime", shape: UNVOTABLE });
    }
  }
}

// --- shared ------------------------------------------------------------

// --- rubygems ----------------------------------------------------------

/**
 * A Gemfile is Ruby, read line by line: `gem "name", "~> 1.2"` with the
 * groups a `group :development do` block opens. A gemspec's dependencies
 * are code, and stay unread.
 */
async function parseRubygems(inventory: Inventory, deps: Dep[]): Promise<void> {
  const text = await readIfExists(join(inventory.root, "Gemfile"));
  if (text === undefined) return;
  const DEV_GEM_GROUPS = new Set(["development", "test", "doc", "docs", "lint"]);
  let depth = 0;
  const groupDepths: { depth: number; dev: boolean }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line === "") continue;
    const group = line.match(/^group\s+(.+?)\s+do$/);
    if (group) {
      const names = [...(group[1] as string).matchAll(/:(\w+)/g)].map((m) => m[1] as string);
      depth++;
      groupDepths.push({ depth, dev: names.every((name) => DEV_GEM_GROUPS.has(name)) });
      continue;
    }
    if (/\bdo\b\s*$/.test(line)) {
      depth++;
      continue;
    }
    if (line === "end") {
      if (groupDepths[groupDepths.length - 1]?.depth === depth) groupDepths.pop();
      depth = Math.max(0, depth - 1);
      continue;
    }
    const gem = line.match(/^gem\s+["']([^"']+)["']\s*(.*)$/);
    if (!gem) continue;
    const name = gem[1] as string;
    const rest = gem[2] as string;
    const inline = rest.match(/group:\s*(?:\[([^\]]*)\]|:(\w+))/);
    const inlineDev = inline
      ? [...(inline[1] ?? `:${inline[2]}`).matchAll(/:(\w+)/g)].every((m) =>
          DEV_GEM_GROUPS.has(m[1] as string),
        )
      : undefined;
    const dev = inlineDev ?? groupDepths.some((g) => g.dev);
    const specs = [...rest.matchAll(/^(?:,\s*)?["']([^"']+)["']|,\s*["']([^"']+)["']/g)]
      .map((m) => (m[1] ?? m[2]) as string)
      .filter((spec) => /^[~><=\d]/.test(spec));
    const shape = /\b(?:git|github|path):/.test(rest) ? UNVOTABLE : gemShape(specs);
    deps.push({ ecosystem: "rubygems", name, bucket: dev ? "dev" : "runtime", shape });
  }
}

function gemShape(specs: string[]): Policy | typeof UNVOTABLE {
  if (specs.length === 0) return "latest";
  if (specs.some((s) => s.startsWith("~>"))) return "caret";
  if (specs.some((s) => /^=?\s*\d/.test(s))) return "pinned";
  if (specs.some((s) => s.startsWith(">")))
    return specs.some((s) => s.startsWith("<")) ? "caret" : "latest";
  return UNVOTABLE;
}

// --- maven (and gradle) ------------------------------------------------

/**
 * The JVM: a pom.xml's `<dependency>` blocks, or the `implementation("g:a:v")`
 * lines of a Gradle build file, named `group:artifact`. A version that is a
 * property or a project reference abstains from the policy vote.
 */
async function parseMaven(inventory: Inventory, deps: Dep[], notes: string[]): Promise<void> {
  const pom = await readIfExists(join(inventory.root, "pom.xml"));
  if (pom !== undefined) {
    const blocks = pom.match(/<dependency>[\s\S]*?<\/dependency>/g) ?? [];
    if (blocks.length === 0 && /<dependencies>/.test(pom)) {
      notes.push("pom.xml declares dependencies dolly could not read; nothing extracted from it.");
    }
    for (const block of blocks) {
      const field = (tag: string) =>
        block.match(new RegExp(`<${tag}>\\s*([^<]+?)\\s*</${tag}>`))?.[1];
      const group = field("groupId");
      const artifact = field("artifactId");
      if (!group || !artifact) continue;
      const scope = field("scope") ?? "compile";
      deps.push({
        ecosystem: "maven",
        name: `${group}:${artifact}`,
        bucket: scope === "test" || scope === "provided" ? "dev" : "runtime",
        shape: mavenShape(field("version")),
      });
    }
    return;
  }
  for (const file of ["build.gradle.kts", "build.gradle"]) {
    const text = await readIfExists(join(inventory.root, file));
    if (text === undefined) continue;
    const lines = text.matchAll(
      /^\s*(implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly)\s*\(?\s*["']([^"':]+):([^"':]+)(?::([^"']+))?["']/gm,
    );
    for (const m of lines) {
      const configuration = m[1] as string;
      deps.push({
        ecosystem: "maven",
        name: `${m[2]}:${m[3]}`,
        bucket: configuration.startsWith("test") ? "dev" : "runtime",
        shape: gradleShape(m[4]),
      });
    }
    return;
  }
}

function mavenShape(version: string | undefined): Policy | typeof UNVOTABLE {
  if (version === undefined) return UNVOTABLE; // managed by a parent or a BOM
  if (/^\$\{/.test(version)) return UNVOTABLE;
  if (/^(LATEST|RELEASE)$/.test(version)) return "latest";
  if (/^[[(]/.test(version)) return "caret";
  return "pinned";
}

function gradleShape(version: string | undefined): Policy | typeof UNVOTABLE {
  if (version === undefined || version.startsWith("$")) return UNVOTABLE;
  if (/^latest\./.test(version) || version === "+") return "latest";
  if (/\+$/.test(version) || /^[[(]/.test(version)) return "caret";
  return "pinned";
}

// --- composer ----------------------------------------------------------

async function parseComposer(inventory: Inventory, deps: Dep[], notes: string[]): Promise<void> {
  const path = join(inventory.root, "composer.json");
  if (!(await Bun.file(path).exists())) return;
  const manifest = await readJsonSafe(path);
  if (!manifest) {
    notes.push("composer.json could not be parsed; PHP dependencies not extracted.");
    return;
  }
  for (const [section, bucket] of [
    ["require", "runtime"],
    ["require-dev", "dev"],
  ] as const) {
    for (const [name, spec] of Object.entries(
      (manifest[section] as Record<string, string> | undefined) ?? {},
    )) {
      // "php" and "ext-*" are the platform, not libraries.
      if (name === "php" || name.startsWith("ext-") || name.startsWith("lib-")) continue;
      if (typeof spec !== "string") continue;
      deps.push({ ecosystem: "composer", name, bucket, shape: composerShape(spec) });
    }
  }
}

function composerShape(spec: string): Policy | typeof UNVOTABLE {
  const s = spec.trim();
  if (s === "" || s === "*" || s.startsWith("dev-") || s.endsWith("@dev")) return "latest";
  if (/^\d+(\.\d+)*$/.test(s)) return "pinned";
  if (/^[\^~]/.test(s) || /\.\*$/.test(s) || s.includes(" - ")) return "caret";
  if (/[<>]/.test(s)) return s.includes("<") ? "caret" : "latest";
  return UNVOTABLE;
}

// --- nuget -------------------------------------------------------------

/**
 * Every project file in the tree (a solution spreads them over
 * directories), each `<PackageReference Include="Id" Version="1.2.3" />`,
 * plus the versions Directory.Packages.props keeps centrally.
 */
async function parseNuget(inventory: Inventory, deps: Dep[], notes: string[]): Promise<void> {
  const projects = inventory.files.filter((f) => /\.(csproj|fsproj|vbproj)$/i.test(f.path));
  if (projects.length === 0) return;
  const central = new Map<string, string>();
  const props = await readIfExists(join(inventory.root, "Directory.Packages.props"));
  for (const m of (props ?? "").matchAll(
    /<PackageVersion\s+Include="([^"]+)"\s+Version="([^"]+)"/g,
  )) {
    central.set((m[1] as string).toLowerCase(), m[2] as string);
  }
  const seen = new Set<string>();
  for (const project of projects) {
    const text = await readIfExists(join(inventory.root, project.path));
    if (text === undefined) continue;
    const testProject = /<IsTestProject>\s*true\s*<\/IsTestProject>/i.test(text);
    for (const m of text.matchAll(/<PackageReference\s+([^>]*?)\/?>/g)) {
      const attrs = m[1] as string;
      const id = attrs.match(/Include="([^"]+)"/)?.[1];
      if (!id) continue;
      const key = `${project.path}\0${id.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const version = attrs.match(/Version="([^"]+)"/)?.[1] ?? central.get(id.toLowerCase());
      deps.push({
        ecosystem: "nuget",
        name: id,
        bucket: testProject ? "dev" : "runtime",
        shape: nugetShape(version),
      });
    }
    if (/<PackageReference/.test(text) && !/Include="/.test(text)) {
      notes.push(`${project.path} declares package references dolly could not read.`);
    }
  }
}

function nugetShape(version: string | undefined): Policy | typeof UNVOTABLE {
  if (version === undefined || version.startsWith("$")) return UNVOTABLE;
  if (/\*/.test(version)) return "caret";
  if (/^[[(]/.test(version)) return /^\[[^,]+\]$/.test(version) ? "pinned" : "caret";
  return "pinned"; // a bare NuGet version is a floor, and restore takes the lowest match
}
