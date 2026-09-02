import { deepEqual } from "../check/support";
import type { Pattern, Toolchain } from "../pattern/schema";
import { isPlainObject, parseByExtension, serializeByExtension } from "../serialize";
import { comparePaths } from "../tree/inventory";
import type { RepoExtract } from "./extract";

/**
 * Several repositories, one pattern: what they agree on. A facet value is
 * kept when a majority of the repositories carry it and every one that
 * does says the same thing; anything else is left out and named in the
 * notes, so the author can promote it by hand (ADR-0003's three-way
 * degradation, applied across trees instead of within one). A structured
 * config keeps the keys the repositories share; an unstructured one must
 * match byte for byte. The order the repositories were given breaks ties.
 */
export interface Agreement {
  pattern: Pattern;
  /** Pattern-relative path → contents, for the captures that agreed. */
  files: Record<string, string>;
  /** What was left out, and why. */
  notes: string[];
}

export function agreePatterns(repos: RepoExtract[], name: string): Agreement {
  const n = repos.length;
  const majority = Math.floor(n / 2) + 1;
  const notes: string[] = [];
  const files: Record<string, string> = {};
  const labels = repos.map((r) => r.name);

  /** One value the carriers agree on, or undefined with the reason noted. */
  const agree = <T>(label: string, values: (T | undefined)[]): T | undefined => {
    const carriers = values
      .map((value, i) => ({ value, repo: labels[i] as string }))
      .filter((c): c is { value: T; repo: string } => c.value !== undefined);
    if (carriers.length === 0) return undefined;
    if (carriers.length < majority) {
      notes.push(
        `${label} is set in ${carriers.length} of ${n} repositories (${carriers.map((c) => c.repo).join(", ")}); left out.`,
      );
      return undefined;
    }
    const first = carriers[0] as { value: T; repo: string };
    if (carriers.every((c) => deepEqual(c.value, first.value))) return first.value;
    const said = carriers.map((c) => `${c.repo} says ${JSON.stringify(c.value)}`).join(", ");
    notes.push(`${label} disagrees: ${said}; left out.`);
    return undefined;
  };

  /** A record facet, key by key. */
  const agreeRecord = <T>(
    label: string,
    records: (Record<string, T> | undefined)[],
  ): Record<string, T> => {
    const keys = [...new Set(records.flatMap((r) => Object.keys(r ?? {})))].sort();
    const out: Record<string, T> = {};
    for (const key of keys) {
      const value = agree(
        `${label}.${key}`,
        records.map((r) => r?.[key]),
      );
      if (value !== undefined) out[key] = value;
    }
    return out;
  };

  /** List members a majority carries, dominant first, the given order breaking ties. */
  const agreeList = (values: (string[] | undefined)[]): string[] => {
    const counts = new Map<string, number>();
    for (const list of values)
      for (const item of list ?? []) counts.set(item, (counts.get(item) ?? 0) + 1);
    const order = [...new Set(values.flatMap((list) => list ?? []))];
    return order
      .filter((item) => (counts.get(item) ?? 0) >= majority)
      .sort(
        (a, b) =>
          (counts.get(b) as number) - (counts.get(a) as number) ||
          order.indexOf(a) - order.indexOf(b),
      );
  };

  const patterns = repos.map((r) => r.result.document.pattern);
  const pick = <K extends keyof Pattern>(key: K) => patterns.map((p) => p[key]);

  // --- scalars and records --------------------------------------------------
  const license = agree("license", pick("license"));

  const languagesIn = pick("languages");
  const programming = agreeList(languagesIn.map((l) => l?.programming));
  const versions = agreeRecord(
    "languages.versions",
    languagesIn.map((l) => l?.versions),
  );
  const natural = agree(
    "languages.natural",
    languagesIn.map((l) => l?.natural),
  );
  const languages =
    programming.length > 0 || Object.keys(versions).length > 0 || natural !== undefined
      ? { programming, versions, ...(natural ? { natural } : {}) }
      : undefined;

  const namingIn = pick("naming");
  const naming = {
    files: agree(
      "naming.files",
      namingIn.map((f) => f?.files),
    ),
    directories: agree(
      "naming.directories",
      namingIn.map((f) => f?.directories),
    ),
    extensions: agreeRecord(
      "naming.extensions",
      namingIn.map((f) => f?.extensions),
    ),
  };
  const hasNaming = naming.files || naming.directories || Object.keys(naming.extensions).length > 0;

  const testingIn = pick("testing");
  const placement = agree(
    "testing.placement",
    testingIn.map((t) => t?.placement),
  );
  const filePattern = placement
    ? agree(
        "testing.filePattern",
        testingIn.map((t) => t?.filePattern),
      )
    : undefined;

  const commandsRecord = agreeRecord("commands", pick("commands"));

  const depsIn = pick("dependencies");
  const runtime = agreeRecord(
    "dependencies.runtime",
    depsIn.map((d) => d?.runtime),
  );
  const dev = agreeRecord(
    "dependencies.dev",
    depsIn.map((d) => d?.dev),
  );
  const versionPolicy = agree(
    "dependencies.versionPolicy",
    depsIn.map((d) => d?.versionPolicy),
  );
  const hasDeps = Object.keys(runtime).length > 0 || Object.keys(dev).length > 0 || versionPolicy;

  const commitsIn = pick("commits");
  const style = agree(
    "commits.style",
    commitsIn.map((c) => c?.style),
  );
  const commits = style
    ? {
        style,
        types: agreeList(commitsIn.map((c) => c?.types)),
        scope: agree(
          "commits.scope",
          commitsIn.map((c) => c?.scope),
        ),
        subject: agree(
          "commits.subject",
          commitsIn.map((c) => c?.subject),
        ),
      }
    : undefined;

  const releasesIn = pick("releases");
  const releases = {
    versioning: agree(
      "releases.versioning",
      releasesIn.map((r) => r?.versioning),
    ),
    changelog: agree(
      "releases.changelog",
      releasesIn.map((r) => r?.changelog),
    ),
    tool: agree(
      "releases.tool",
      releasesIn.map((r) => r?.tool),
    ),
  };
  const hasReleases = releases.versioning || releases.changelog || releases.tool;

  // --- toolchain: roles by agreement, configs by shared keys -------------------
  const toolchainIn = pick("toolchain");
  const roles = [
    "packageManager",
    "formatter",
    "linter",
    "typechecker",
    "testRunner",
    "taskRunner",
    "ci",
    "hooks",
  ] as const;
  const toolchain: Toolchain = { configs: {}, binding: {} };
  for (const role of roles) {
    const value = agree(
      `toolchain.${role}`,
      toolchainIn.map((t) => t?.[role]),
    );
    if (value) toolchain[role] = value;
  }
  const sourceIds = [...new Set(toolchainIn.flatMap((t) => Object.keys(t?.configs ?? {})))].sort();
  for (const sourceId of sourceIds) {
    const carriers = repos.flatMap((repo) => {
      const rel = repo.result.document.pattern.toolchain?.configs[sourceId];
      const contents = rel === undefined ? undefined : repo.result.files[rel];
      return rel !== undefined && contents !== undefined
        ? [{ repo: repo.name, rel, contents }]
        : [];
    });
    if (carriers.length < majority) {
      if (carriers.length > 0)
        notes.push(
          `${sourceId} is captured in ${carriers.length} of ${n} repositories (${carriers.map((c) => c.repo).join(", ")}); left out.`,
        );
      continue;
    }
    const first = carriers[0] as { repo: string; rel: string; contents: string };
    if (carriers.every((c) => c.contents === first.contents)) {
      files[first.rel] = first.contents;
      toolchain.configs[sourceId] = first.rel;
      continue;
    }
    const target = sourceId.split("#")[0] as string;
    const shared = sharedKeys(
      carriers.map((c) => c.contents),
      target,
    );
    if (shared === undefined) {
      notes.push(
        `${sourceId} differs between the repositories and is not JSON or TOML, so it was not captured.`,
      );
      continue;
    }
    files[first.rel] = shared;
    toolchain.configs[sourceId] = first.rel;
    notes.push(
      `${sourceId} differs between the repositories; only the keys they all agree on were captured.`,
    );
  }
  const hasToolchain =
    roles.some((role) => toolchain[role] !== undefined) ||
    Object.keys(toolchain.configs).length > 0;

  // --- layout: entries a majority carries, required only when all say so -------
  const layoutIn = pick("layout");
  const carriersOf = new Map<string, { required: boolean; description?: string }[]>();
  for (const entries of layoutIn) {
    for (const entry of entries) {
      carriersOf.set(entry.path, [...(carriersOf.get(entry.path) ?? []), entry]);
    }
  }
  const layout = [...carriersOf.entries()]
    .filter(([, carriers]) => carriers.length >= majority)
    .map(([path, carriers]) => ({
      path,
      required: carriers.every((c) => c.required),
      ...(carriers[0]?.description ? { description: carriers[0].description } : {}),
    }))
    .sort((a, b) => comparePaths(a.path, b.path));
  const minority = [...carriersOf.entries()].filter(([, c]) => c.length < majority).map(([p]) => p);
  if (minority.length > 0) {
    const shown = minority.sort(comparePaths).slice(0, 8).join(", ");
    notes.push(
      `${minority.length} layout entr${minority.length === 1 ? "y appears" : "ies appear"} in fewer than ${majority} repositories and ${minority.length === 1 ? "was" : "were"} left out: ${shown}${minority.length > 8 ? ", …" : ""}.`,
    );
  }

  // --- templates: a majority, byte-identical -------------------------------------
  const templateTargets = [...new Set(patterns.flatMap((p) => p.scaffold?.templates ?? []))].sort(
    comparePaths,
  );
  const templates: string[] = [];
  for (const target of templateTargets) {
    const carriers = repos.flatMap((repo) => {
      const contents = repo.result.files[`templates/${target}`];
      return repo.result.document.pattern.scaffold?.templates.includes(target) &&
        contents !== undefined
        ? [{ repo: repo.name, contents }]
        : [];
    });
    const first = carriers[0];
    if (!first || carriers.length < majority) {
      if (first)
        notes.push(
          `Template ${target} is captured in ${carriers.length} of ${n} repositories; left out.`,
        );
      continue;
    }
    if (!carriers.every((c) => c.contents === first.contents)) {
      notes.push(`Template ${target} differs between the repositories; left out.`);
      continue;
    }
    templates.push(target);
    files[`templates/${target}`] = first.contents;
  }

  const pattern: Pattern = {
    format: 1,
    name,
    description: `Extracted from the ${labels.join(", ")} projects, keeping what they agree on.`,
    ...(license ? { license } : {}),
    ...(languages ? { languages } : {}),
    ...(hasNaming
      ? {
          naming: {
            ...(naming.files ? { files: naming.files } : {}),
            ...(naming.directories ? { directories: naming.directories } : {}),
            extensions: naming.extensions,
          },
        }
      : {}),
    layout,
    ...(hasToolchain ? { toolchain } : {}),
    ...(placement ? { testing: { placement, ...(filePattern ? { filePattern } : {}) } } : {}),
    ...(Object.keys(commandsRecord).length > 0 ? { commands: commandsRecord } : {}),
    ...(hasDeps
      ? { dependencies: { runtime, dev, ...(versionPolicy ? { versionPolicy } : {}) } }
      : {}),
    ...(templates.length > 0 ? { scaffold: { templates } } : {}),
    ...(commits
      ? {
          commits: {
            style: commits.style,
            types: commits.types,
            ...(commits.scope ? { scope: commits.scope } : {}),
            ...(commits.subject ? { subject: commits.subject } : {}),
          },
        }
      : {}),
    ...(hasReleases
      ? {
          releases: {
            ...(releases.versioning ? { versioning: releases.versioning } : {}),
            ...(releases.changelog ? { changelog: releases.changelog } : {}),
            ...(releases.tool ? { tool: releases.tool } : {}),
          },
        }
      : {}),
  };
  return { pattern, files, notes };
}

/**
 * The keys every copy of a structured config agrees on, reserialized in the
 * formatter's shape; undefined when the file is not JSON or TOML, or when
 * any copy will not parse.
 */
function sharedKeys(copies: string[], target: string): string | undefined {
  if (!/\.(jsonc?|toml)$/i.test(target)) return undefined;
  let parsed: unknown[];
  try {
    parsed = copies.map((text) => parseByExtension(target.replace(/\.jsonc$/i, ".json"), text));
  } catch {
    return undefined;
  }
  const shared = intersect(parsed);
  if (!isPlainObject(shared)) return undefined;
  return serializeByExtension(target.replace(/\.jsonc$/i, ".json"), shared);
}

/** What every value has in common: equal leaves, and objects reduced to their agreeing keys. */
function intersect(values: unknown[]): unknown {
  const first = values[0];
  if (values.every((value) => deepEqual(value, first))) return first;
  if (!values.every(isPlainObject)) return undefined;
  const records = values as Record<string, unknown>[];
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(records[0] as Record<string, unknown>)) {
    if (!records.every((record) => Object.hasOwn(record, key))) continue;
    const shared = intersect(records.map((record) => record[key]));
    if (shared !== undefined) out[key] = shared;
  }
  return out;
}
