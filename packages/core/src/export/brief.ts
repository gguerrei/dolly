import type { PatternDocument } from "../pattern/document";
import type {
  Commits,
  Dependencies,
  Languages,
  LayoutEntry,
  Naming,
  Releases,
  Testing,
  Toolchain,
} from "../pattern/schema";

/**
 * The brief: a pattern's facets as prose a reader (or a model) can follow
 * without dolly, then the author's own conventions. Every text target
 * renders this one body and adds only its frame, so no two exports can
 * disagree on what a facet means.
 */
export function renderBrief(doc: PatternDocument): string {
  const { pattern } = doc;
  const sections: [string, string[]][] = [
    ["Languages", languages(pattern.languages)],
    ["Layout", layout(pattern.layout)],
    ["Naming", naming(pattern.naming)],
    ["Toolchain", toolchain(pattern.toolchain)],
    ["Dependencies", dependencies(pattern.dependencies)],
    ["Testing", testing(pattern.testing)],
    ["Commands", commands(pattern.commands)],
    ["License", pattern.license ? [`- Projects are licensed under ${pattern.license}.`] : []],
    ["Commits", commits(pattern.commits)],
    ["Releases", releases(pattern.releases)],
    ["Conventions", conventions(doc.prose)],
  ];
  return sections
    .filter(([, lines]) => lines.length > 0)
    .map(([title, lines]) => `## ${title}\n\n${lines.join("\n")}`)
    .join("\n\n");
}

const code = (s: string) => `\`${s}\``;
const list = (items: string[]) => items.map(code).join(", ");

function languages(facet?: Languages): string[] {
  if (!facet) return [];
  const lines: string[] = [];
  const [first, ...rest] = facet.programming;
  if (first) {
    const also =
      rest.length === 0
        ? ""
        : `; ${rest.join(", ")} ${rest.length === 1 ? "is" : "are"} also sanctioned`;
    lines.push(`- Write code in ${first}${also}. Do not introduce another language.`);
  }
  const pins = Object.entries(facet.versions).map(([runtime, range]) => `${runtime} ${range}`);
  if (pins.length) lines.push(`- Runtime versions: ${pins.join(", ")}.`);
  if (facet.natural) {
    lines.push(`- Docs and comments are written in ${languageName(facet.natural)}.`);
  }
  return lines;
}

/** "en" as "English", or the tag itself when the runtime cannot name it. */
function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

function layout(entries: LayoutEntry[]): string[] {
  if (entries.length === 0) return [];
  const lines = entries.map(
    (entry) =>
      `- ${code(entry.path)}${entry.required ? " (required)" : ""}${
        entry.description ? `: ${entry.description}` : ""
      }`,
  );
  if (entries.some((entry) => entry.path.includes("{name}"))) {
    lines.push("", "`{name}` stands for exactly one path segment of your choosing.");
  }
  return lines;
}

function naming(facet?: Naming): string[] {
  if (!facet) return [];
  const lines: string[] = [];
  if (facet.files) lines.push(`- Files are named in ${facet.files}.`);
  if (facet.directories) lines.push(`- Directories are named in ${facet.directories}.`);
  for (const [extension, style] of Object.entries(facet.extensions)) {
    lines.push(`- ${code(extension)} files are named in ${style}.`);
  }
  return lines;
}

const ROLES: [keyof Toolchain, string][] = [
  ["packageManager", "Package manager"],
  ["formatter", "Formatter"],
  ["linter", "Linter"],
  ["typechecker", "Typechecker"],
  ["testRunner", "Test runner"],
  ["taskRunner", "Task runner"],
  ["ci", "CI"],
  ["hooks", "Git hooks"],
];

function toolchain(facet?: Toolchain): string[] {
  if (!facet) return [];
  const lines = ROLES.filter(([role]) => typeof facet[role] === "string").map(
    ([role, label]) => `- ${label}: ${facet[role] as string}.`,
  );
  const configs = Object.keys(facet.configs);
  if (configs.length) {
    lines.push(
      `- The pattern carries these configs, which ${code("dolly new")} and ${code("dolly fit")} place: ${list(configs)}.`,
    );
  }
  return lines;
}

const POLICIES: Record<NonNullable<Dependencies["versionPolicy"]>, string> = {
  pinned: "pinned exactly",
  caret: "written as compatible ranges",
  latest: "left unbounded",
};

function dependencies(facet?: Dependencies): string[] {
  if (!facet) return [];
  const lines: string[] = [];
  const purposes = (group: Record<string, string>, kind: string) =>
    Object.entries(group).map(([purpose, library]) => `- ${kind} ${purpose}: ${library}.`);
  lines.push(...purposes(facet.runtime, "For"), ...purposes(facet.dev, "For development"));
  if (facet.versionPolicy)
    lines.push(`- Dependency versions are ${POLICIES[facet.versionPolicy]}.`);
  return lines;
}

function testing(facet?: Testing): string[] {
  if (!facet) return [];
  const where =
    facet.placement === "colocated"
      ? "Tests sit beside the code they test"
      : "Tests live in a separate test directory";
  const named = facet.filePattern
    ? `, named ${code(facet.filePattern)}${
        facet.filePattern.includes("{stem}") ? " where `{stem}` is the source file's basename" : ""
      }`
    : "";
  return [`- ${where}${named}.`];
}

function commands(facet?: Record<string, string>): string[] {
  const entries = Object.entries(facet ?? {});
  if (entries.length === 0) return [];
  return [
    "| Verb | Command |",
    "|---|---|",
    ...entries.map(([verb, command]) => `| ${verb} | ${code(command)} |`),
  ];
}

function commits(facet?: Commits): string[] {
  if (!facet) return [];
  const lines: string[] = [];
  if (facet.style === "conventional") {
    const shape = facet.scope === "never" ? "type: subject" : "type(scope): subject";
    lines.push(`- Commit messages follow Conventional Commits: ${code(shape)}.`);
    if (facet.types.length) lines.push(`- Types in use: ${facet.types.join(", ")}.`);
    if (facet.scope === "required") lines.push("- Every commit carries a scope.");
    if (facet.scope === "optional") lines.push("- Scopes are optional.");
    if (facet.scope === "never") lines.push("- Scopes are not used.");
  } else if (facet.style === "gitmoji") {
    lines.push("- Commit subjects start with a gitmoji.");
  } else {
    lines.push("- Commit subjects are plain sentences, with no type prefix.");
  }
  if (facet.subject === "lower") lines.push("- Subjects start in lower case.");
  if (facet.subject === "sentence") lines.push("- Subjects start with a capital letter.");
  return lines;
}

function releases(facet?: Releases): string[] {
  if (!facet) return [];
  const lines: string[] = [];
  if (facet.versioning === "semver") lines.push("- Versions follow semantic versioning.");
  if (facet.versioning === "calver") lines.push("- Versions follow calendar versioning.");
  if (facet.changelog === "keep-a-changelog") {
    lines.push(
      "- `CHANGELOG.md` is kept by hand in Keep a Changelog form; add an entry under Unreleased with every change.",
    );
  }
  if (facet.changelog === "generated") {
    lines.push("- The changelog is generated at release time; never edit it by hand.");
  }
  if (facet.tool) lines.push(`- Releases run through ${facet.tool}.`);
  return lines;
}

/** The author's prose with its headings demoted one level, so its structure nests under the export's. */
function conventions(prose: string): string[] {
  const body = prose.trim();
  if (!body) return [];
  let fenced = false;
  return body.split("\n").map((line) => {
    if (line.startsWith("```")) fenced = !fenced;
    return !fenced && /^#{1,5} /.test(line) ? `#${line}` : line;
  });
}
