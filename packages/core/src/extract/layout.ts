import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import type { LayoutEntry } from "../pattern/schema";
import { readIfExists, readJsonSafe } from "../tree/files";
import { comparePaths, type Inventory } from "../tree/inventory";
import { expandGlobs } from "./globs";

/**
 * Generalizes the repo tree into layout entries with three evidence classes:
 * external priors (anchor vocabulary), self-declaration (workspace globs,
 * .gitkeep), and sibling-shape voting that turns src/users|orders|billing
 * into src/{name}/, over directories and over file-per-resource dirs alike.
 * Files are incidental by default; that rule, not the entry budget, is the
 * primary size bound.
 */
export const LAYOUT_TUNING = {
  maxDepth: 4,
  templateInnerDepth: 2,
  minGroup: 3,
  entryBudget: 50,
  /** Sibling support ratio for template-core paths. */
  coreRatio: [6, 10] as const,
};

/** Closed structural vocabulary: these names are the pattern, not instances of it. */
const STOPLIST = new Set([
  "src",
  "lib",
  "test",
  "tests",
  "docs",
  "components",
  "utils",
  "helpers",
  "hooks",
  "types",
  "models",
  "views",
  "controllers",
  "api",
  "assets",
  "public",
  "static",
  "scripts",
  "config",
  "common",
  "shared",
  "core",
  "internal",
  "cmd",
  "pkg",
  "app",
  "apps",
  "packages",
  "crates",
  "examples",
  "migrations",
]);

/** Root files that are structure in their own right. */
const ANCHOR_PATTERNS = [
  /^readme($|\.)/i,
  /^license($|\.)/i,
  /^contributing\.md$/i,
  /^changelog\.md$/i,
  /^code_of_conduct\.md$/i,
  /^security\.md$/i,
  /^package\.json$/,
  /^pyproject\.toml$/,
  /^cargo\.toml$/i,
  /^go\.mod$/,
  /^tsconfig.*\.json$/,
  /^makefile$/i,
  /^justfile$/i,
  /^dockerfile$/i,
  /^docker-compose.*\.ya?ml$/,
  /^\.editorconfig$/,
  /^\.gitignore$/,
  /^\.gitattributes$/,
  /^\.env\.example$/,
];

/** Depth-1 dirs required only when the name itself corroborates (one repo can't). */
const ROOT_VOCAB = new Set([
  "src",
  "packages",
  "apps",
  "docs",
  "tests",
  "test",
  "scripts",
  "lib",
  "cmd",
  "pkg",
  "internal",
  "crates",
]);

/** Names that never vote in file-sibling groups. */
const FILE_GROUP_EXCLUDED =
  /^(__init__|index|main|mod|types?|utils?|helpers?|constants?|README|__main__)\./i;

export interface LayoutScan {
  layout: LayoutEntry[];
  notes: string[];
  /** Emitted `{name}` groups, so the scaffold scanner votes on the same members. */
  templateGroups: TemplateGroup[];
}

/** One generalized path plus the real files behind it, for template capture. */
export interface TemplateGroup {
  /** The layout path, e.g. "packages/{name}/tsconfig.json". */
  target: string;
  /** The sibling files it generalizes, with the name each contributed. */
  members: { path: string; name: string }[];
}

export async function scanLayout(
  inventory: Inventory,
  claimedConfigs: Set<string>,
): Promise<LayoutScan> {
  const notes: string[] = [];
  const childrenDirs = new Map<string, string[]>();
  const childrenFiles = new Map<string, string[]>();
  for (const dir of inventory.dirs) {
    const parent = parentOf(dir);
    push(childrenDirs, parent, dir);
  }
  for (const file of inventory.files) {
    push(childrenFiles, parentOf(file.path), file.path);
  }

  const workspaceParents = await workspaceMembers(inventory);
  const gitkeepDirs = new Set(
    inventory.files
      .filter((f) => /(^|\/)\.(gitkeep|keep)$/.test(f.path))
      .map((f) => parentOf(f.path)),
  );

  const entries: LayoutEntry[] = [];
  const consumed = new Set<string>(); // dirs/files owned by an emitted template group
  const templateGroups: TemplateGroup[] = [];
  const filePaths = new Set(inventory.files.map((f) => f.path));

  // --- E2/E3: sibling groups, top-down so nested groups never overlap ---
  const groupParents = [...new Set([...childrenDirs.keys()])].sort(comparePaths);
  for (const parent of groupParents) {
    if (isConsumed(parent, consumed)) continue;
    const children = (childrenDirs.get(parent) ?? []).filter((d) => !isConsumed(d, consumed));
    const workspace = workspaceParents.get(parent);
    const group = voteDirGroup(parent, children, workspace, childrenDirs, childrenFiles, notes);
    if (!group) continue;
    for (const entry of group.entries) entries.push(entry);
    for (const member of group.members) consumed.add(member);
    // A core file every member carries is the group's shape; the scaffold
    // scanner decides whether their contents agree closely enough to capture.
    for (const entry of group.entries) {
      const core = entry.path.endsWith("/") ? undefined : relative(group.base, entry.path);
      if (core === undefined) continue;
      const members = group.members.map((member) => ({
        path: `${member}/${core.replaceAll("{name}", basenameOf(member))}`,
        name: basenameOf(member),
      }));
      if (members.every((m) => filePaths.has(m.path)))
        templateGroups.push({ target: entry.path, members });
    }
  }

  // --- E3 over files: homogeneous leaf dirs are file-per-resource conventions ---
  for (const dir of inventory.dirs) {
    if (isConsumed(dir, consumed)) continue;
    if ((childrenDirs.get(dir) ?? []).length > 0) continue;
    if (dir.split("/").some((s) => s.startsWith("."))) continue; // .github/… is tool vocabulary
    if (STOPLIST.has(basenameOf(dir)) || inventory.vendored.includes(dir)) continue;
    const files = (childrenFiles.get(dir) ?? [])
      .map(basenameOf)
      .filter((name) => !FILE_GROUP_EXCLUDED.test(name) && !name.startsWith("."));
    if (files.length < LAYOUT_TUNING.minGroup) continue;
    const byTemplate = new Map<string, string[]>();
    for (const file of files) push(byTemplate, fileTemplate(file), file);
    if (byTemplate.size === 1) {
      const [template, names] = [...byTemplate][0] as [string, string[]];
      entries.push({
        path: `${dir}/${template}`,
        required: false,
        description: `generalized from ${names.map(stemOf).sort().slice(0, 4).join(", ")}`,
      });
      templateGroups.push({
        target: `${dir}/${template}`,
        members: names.map((name) => ({ path: `${dir}/${name}`, name: stemOf(name) })),
      });
      for (const file of childrenFiles.get(dir) ?? []) consumed.add(file);
    } else if ([...byTemplate.values()].some((names) => names.length >= LAYOUT_TUNING.minGroup)) {
      const counts = [...byTemplate].map(([t, names]) => `${names.length}× ${t}`).sort();
      notes.push(
        `${dir}/ mixes file shapes (${counts.join(", ")}), so it is not uniform enough for a {name} entry; add one by hand if intentional.`,
      );
    }
  }

  // --- E1: literal directories within the (chain-collapsed) depth cap ---
  for (const dir of inventory.dirs) {
    if (isConsumed(dir, consumed)) continue;
    if (effectiveDepth(dir, childrenDirs, childrenFiles) > LAYOUT_TUNING.maxDepth) continue;
    const depth1 = !dir.includes("/");
    const required =
      (depth1 && ROOT_VOCAB.has(dir)) || workspaceParents.has(dir) || gitkeepDirs.has(dir);
    const vendored = inventory.vendored.includes(dir);
    entries.push({
      path: `${dir}/`,
      required,
      ...(vendored ? { description: "third-party; contents not modeled" } : {}),
    });
  }

  // --- E1: root anchor files + toolchain-claimed configs ---
  for (const file of inventory.files) {
    if (isConsumed(file.path, consumed)) continue;
    const atRoot = !file.path.includes("/");
    const basename = basenameOf(file.path);
    if (atRoot && ANCHOR_PATTERNS.some((p) => p.test(basename))) {
      entries.push({ path: file.path, required: true });
    } else if (claimedConfigs.has(file.path)) {
      entries.push({ path: file.path, required: false });
    }
  }

  // Only ambiguous names get a note; node_modules or caches are never source.
  const ambiguousDeny = new Set(["dist", "build", "out", "coverage", "target"]);
  for (const denied of inventory.denied.filter((d) => !d.includes("/") && ambiguousDeny.has(d))) {
    notes.push(
      `${denied}/ exists and was treated as build output, not source; add it to layout by hand if it is source.`,
    );
  }

  // --- Budget: drop deepest optional entries first, and say so ---
  entries.sort((a, b) => comparePaths(a.path, b.path));
  if (entries.length > LAYOUT_TUNING.entryBudget) {
    const optional = entries
      .filter((e) => !e.required)
      .sort((a, b) => depthOf(b.path) - depthOf(a.path) || comparePaths(b.path, a.path));
    const toDrop = new Set<LayoutEntry>();
    for (const entry of optional) {
      if (entries.length - toDrop.size <= LAYOUT_TUNING.entryBudget) break;
      toDrop.add(entry);
    }
    if (toDrop.size > 0) {
      notes.push(
        `Layout truncated to ${LAYOUT_TUNING.entryBudget} entries; ${toDrop.size} deep optional paths were dropped.`,
      );
    }
    const kept = entries.filter((e) => !toDrop.has(e));
    const keptPaths = new Set(kept.map((e) => e.path));
    return {
      layout: kept,
      notes,
      templateGroups: templateGroups.filter((g) => keptPaths.has(g.target)),
    };
  }
  return { layout: entries, notes, templateGroups };
}

interface DirGroup {
  entries: LayoutEntry[];
  members: string[];
  /** The generalized prefix these entries hang off, e.g. "packages/{name}". */
  base: string;
}

function voteDirGroup(
  parent: string,
  children: string[],
  workspace: string[] | undefined,
  childrenDirs: Map<string, string[]>,
  childrenFiles: Map<string, string[]>,
  notes: string[],
): DirGroup | undefined {
  const candidates = workspace && workspace.length >= 2 ? workspace : children;
  const n = candidates.length;
  if (!workspace) {
    if (n < LAYOUT_TUNING.minGroup) return undefined;
    const stoplisted = candidates.filter((d) => STOPLIST.has(basenameOf(d))).length;
    if (stoplisted * 2 >= n) return undefined;
  }
  if (n < 2) return undefined;

  // Shape each child: its internal paths to a shallow depth, own-name → {name}.
  const shapes = new Map<string, Set<string>>();
  for (const child of candidates) {
    const name = basenameOf(child);
    const shape = new Set<string>();
    const inner = (prefix: string, depth: number) => {
      for (const d of childrenDirs.get(prefix) ?? []) {
        shape.add(`${normalizeToken(relative(child, d), name)}/`);
        if (depth < LAYOUT_TUNING.templateInnerDepth) inner(d, depth + 1);
      }
      for (const f of childrenFiles.get(prefix) ?? [])
        shape.add(normalizeToken(relative(child, f), name));
    };
    inner(child, 1);
    shapes.set(child, shape);
  }

  const support = new Map<string, number>();
  for (const shape of shapes.values())
    for (const path of shape) support.set(path, (support.get(path) ?? 0) + 1);

  const [num, den] = LAYOUT_TUNING.coreRatio;
  const coreSupport =
    workspace && n < LAYOUT_TUNING.minGroup
      ? n
      : Math.max(LAYOUT_TUNING.minGroup, Math.ceil((n * num) / den));
  const core = [...support.entries()].filter(([, s]) => s >= coreSupport).map(([p]) => p);
  const members = candidates.filter((child) => {
    const shape = shapes.get(child) as Set<string>;
    const hits = core.filter((p) => shape.has(p)).length;
    return hits >= Math.max(1, Math.ceil(core.length / 2));
  });

  const qualifies = workspace
    ? members.length >= 2
    : members.length >= LAYOUT_TUNING.minGroup && core.length >= 2;
  if (!qualifies) {
    if (!workspace && core.length >= 1 && members.length >= 2) {
      const where = parent === "" ? "the root" : `${parent}/`;
      const sample = core.slice(0, 3).join(", ");
      notes.push(
        members.length === n && core.length === 1
          ? `Every directory under ${where} contains ${sample} (${n}/${n}): a real convention, but too thin for a {name} template; add one by hand if intentional.`
          : `${members.length} of ${n} directories under ${where} share internal files (${sample}), which is below the template threshold; add a {name} entry by hand if intentional.`,
      );
    }
    return undefined;
  }

  const base = parent === "" ? "{name}" : `${parent}/{name}`;
  const memberNames = members.map(basenameOf).sort().slice(0, 4).join(", ");
  const entries: LayoutEntry[] = [
    { path: `${base}/`, required: false, description: `generalized from ${memberNames}` },
    ...core.sort(comparePaths).map((path) => ({
      path: `${base}/${path}`,
      required: (support.get(path) ?? 0) === members.length,
    })),
  ];
  return { entries, members, base };
}

/** users/users.service.ts → {name}.service.ts (whole stem-token match only). */
function normalizeToken(path: string, name: string): string {
  return path
    .split("/")
    .map((segment) => {
      const dot = segment.indexOf(".");
      const stem = dot === -1 ? segment : segment.slice(0, dot);
      return stem === name ? `{name}${dot === -1 ? "" : segment.slice(dot)}` : segment;
    })
    .join("/");
}

/** users.service.ts → {name}.service.ts; init.ts → {name}.ts. */
function fileTemplate(basename: string): string {
  const dot = basename.indexOf(".");
  return dot === -1 ? "{name}" : `{name}${basename.slice(dot)}`;
}

function stemOf(basename: string): string {
  const dot = basename.indexOf(".");
  return dot === -1 ? basename : basename.slice(0, dot);
}

/** Depth where a run of single-child directories counts once (Java trees survive). */
function effectiveDepth(
  dir: string,
  childrenDirs: Map<string, string[]>,
  childrenFiles: Map<string, string[]>,
): number {
  const segments = dir.split("/");
  let depth = 1;
  let prefix = segments[0] as string;
  for (let i = 1; i < segments.length; i++) {
    const onlyChild =
      (childrenDirs.get(prefix) ?? []).length === 1 &&
      (childrenFiles.get(prefix) ?? []).length === 0;
    if (!onlyChild) depth++;
    prefix = `${prefix}/${segments[i]}`;
  }
  return depth;
}

async function workspaceMembers(inventory: Inventory): Promise<Map<string, string[]>> {
  const globs: string[] = [];
  const packageJson = await readJsonSafe(join(inventory.root, "package.json"));
  const workspaces = packageJson?.workspaces as string[] | { packages?: string[] } | undefined;
  if (Array.isArray(workspaces)) globs.push(...workspaces);
  else if (workspaces?.packages) globs.push(...workspaces.packages);
  const pnpm = await readIfExists(join(inventory.root, "pnpm-workspace.yaml"));
  if (pnpm) {
    try {
      globs.push(...((parseYaml(pnpm) as { packages?: string[] })?.packages ?? []));
    } catch {
      // Unparseable workspace file just loses its globs.
    }
  }
  const cargo = await readIfExists(join(inventory.root, "Cargo.toml"));
  if (cargo) {
    try {
      const workspace = (parseToml(cargo) as { workspace?: { members?: string[] } }).workspace;
      globs.push(...(workspace?.members ?? []));
    } catch {
      // Same: no members, no groups.
    }
  }

  const members = expandGlobs(globs, inventory.dirs);
  const byParent = new Map<string, string[]>();
  for (const member of members) push(byParent, parentOf(member), member);
  for (const [parent, list] of byParent) if (list.length < 2) byParent.delete(parent);
  return byParent;
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function relative(base: string, path: string): string {
  return path.slice(base.length + 1);
}

function depthOf(path: string): number {
  return path.replace(/\/$/, "").split("/").length;
}

function isConsumed(path: string, consumed: Set<string>): boolean {
  if (consumed.has(path)) return true;
  for (let slash = path.lastIndexOf("/"); slash !== -1; slash = path.lastIndexOf("/", slash - 1)) {
    if (consumed.has(path.slice(0, slash))) return true;
  }
  return false;
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}
