import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { LICENSE_FILE } from "../extract/license";
import { extensionOf, renderStem } from "../extract/naming";
import {
  type Ecosystem,
  ecosystemOfPattern,
  isManifestName,
  MANIFEST_OF,
} from "../extract/registry";
import { TEST_ROOT_NAMES } from "../extract/testing";
import { markerContents } from "../marker";
import { isSafePatternPath, type Pattern, slugify } from "../pattern/schema";
import { isSafeDottedPath, parseByExtension, serializeByExtension, setDeep } from "../serialize";
import type { PatternStore } from "../store";
import { taskfile } from "../taskfile";
import { pathWithin, readIfExists } from "../tree/files";
import { comparePaths } from "../tree/inventory";
import { renderChangelog } from "./changelog";
import { gitignoreFor, stubContents } from "./content";
import { renderLicense } from "./licenses";

/**
 * `dolly new`: scaffolds a fresh project from a pattern. Layout expanded
 * (root-level {name} becomes the project name, per-module templates are
 * skipped), captured toolchain configs written back where they came from,
 * a base manifest generated with the pattern's commands and license, LICENSE
 * stamped, and git initialized. Everything deterministic; installs are
 * printed as next steps, never run.
 */

/** engines keys that belong in a scaffolded package.json. */
const NPM_ENGINES = new Set(["node", "bun", "npm", "pnpm", "yarn", "deno"]);

/** Tool names whose installable package is spelled differently. */
const INSTALL_NAME: Record<string, string> = {
  biome: "@biomejs/biome",
  "ruff-format": "ruff",
  tsc: "typescript",
  phpunit: "phpunit/phpunit",
  pest: "pestphp/pest",
  phpstan: "phpstan/phpstan",
  psalm: "vimeo/psalm",
  "php-cs-fixer": "friendsofphp/php-cs-fixer",
  pint: "laravel/pint",
  mstest: "MSTest.TestFramework",
  nunit: "NUnit",
};

export class TargetNotEmptyError extends Error {
  override name = "TargetNotEmptyError";

  constructor(dir: string) {
    super(`${dir} already exists and is not empty. Pick a fresh directory.`);
  }
}

export interface ScaffoldReport {
  /** Absolute path of the scaffolded project. */
  root: string;
  projectName: string;
  /** Everything written, project-relative, directories with a trailing "/". */
  created: string[];
  /** Layout entries skipped because their {name} is per-module, not the project. */
  skipped: string[];
  notes: string[];
  /** Shell lines for the user to run next (installs, first commit). */
  nextSteps: string[];
}

export async function scaffoldProject(
  store: PatternStore,
  patternName: string,
  targetDir: string,
): Promise<ScaffoldReport> {
  const { pattern } = await store.load(patternName);
  const root = resolve(targetDir);
  await assertEmptyTarget(root);

  const projectName = slugify(basename(root), "new-project");
  const ecosystem = ecosystemOfPattern(pattern);
  const notes: string[] = [];
  const skipped: string[] = [];
  const dirs = new Set<string>();
  const files = new Map<string, string>();

  // --- Layout: dirs and file placeholders, with {name} expansion ------------
  // A {name} directory segment is a module template: it is instantiated once,
  // named after the project. A {name} in file position (routers/{name}.py) is
  // a per-resource convention with nothing to instantiate yet, so it is skipped.
  const layoutFiles: string[] = [];
  let instantiated = 0;
  for (const entry of pattern.layout) {
    const path = expandName(entry.path, projectName, pattern.naming);
    if (!path) {
      skipped.push(entry.path);
      continue;
    }
    // The schema already refused unsafe paths, but a pattern's own file is
    // hand-editable and this is the last stop before mkdir/writeFile.
    if (!isSafePatternPath(path)) {
      notes.push(`Layout path "${entry.path}" is not a safe relative path; skipped.`);
      continue;
    }
    if (path !== entry.path) instantiated++;
    if (path.endsWith("/")) {
      dirs.add(path.slice(0, -1));
      continue;
    }
    dirs.add(dirname(path)); // "." for root files; dropped before writing
    layoutFiles.push(path);
  }
  if (instantiated > 0) {
    notes.push(
      `Instantiated ${instantiated} {name} template entr${instantiated === 1 ? "y" : "ies"} once, named after the project. Add siblings as it grows.`,
    );
  }
  const workspaceParents = [
    ...new Set(
      pattern.layout
        .map((e) => e.path.match(/^(.+)\/\{name\}\/$/)?.[1])
        .filter((p): p is string => p !== undefined && !p.includes("{name}")),
    ),
  ].sort();

  // --- Captured toolchain configs: plain files back in place, embedded
  // subtrees folded into the file they came from ----------------------------
  const embeds = new Map<string, { dotted: string; contents: string }[]>();
  /** Paths carrying captured bytes; these outrank templates and stubs. */
  const captured = new Set<string>();
  const patternDir = store.dirOf(patternName);
  for (const [sourceId, patternRel] of Object.entries(pattern.toolchain?.configs ?? {})) {
    const target = (sourceId.split("#")[0] as string).trim();
    if (!isSafePatternPath(target)) {
      notes.push(`Config source "${sourceId}" is not a safe relative path; skipped.`);
      continue;
    }
    const contents = await pathWithin(patternDir, patternRel).then(readIfExists, () => undefined);
    if (contents === undefined) {
      notes.push(
        `Captured config ${patternRel} is missing from the pattern; ${target} not written.`,
      );
      continue;
    }
    const hash = sourceId.indexOf("#");
    captured.add(target);
    if (hash === -1) files.set(target, contents);
    else {
      const list = embeds.get(target) ?? [];
      list.push({ dotted: sourceId.slice(hash + 1), contents });
      embeds.set(target, list);
    }
  }

  // --- Base manifest + embed targets ---------------------------------------
  // A manifest the layout places inside a {name} group, with none at the
  // root, is each member's own (a tree of samples, a monorepo whose members
  // carry theirs): the root gets none, and the report says so.
  const memberManifest = pattern.layout.find(
    (entry) => entry.path.includes("{name}/") && isManifestName(basename(entry.path)),
  );
  const rootManifest = pattern.layout.some(
    (entry) => !entry.path.includes("/") && isManifestName(entry.path),
  );
  const manifestPerMember = memberManifest !== undefined && !rootManifest;
  if (manifestPerMember) {
    notes.push(
      `The manifest lives in each member (${memberManifest.path}), so none was written at the root; add members carrying their own.`,
    );
  }
  const manifestPath =
    ecosystem && !manifestPerMember ? manifestPathOf(ecosystem, pattern, projectName) : undefined;
  if (ecosystem === "maven" && manifestPath === "build.gradle.kts") {
    files.set("settings.gradle.kts", `rootProject.name = "${projectName}"\n`);
  }
  for (const target of new Set([...(manifestPath ? [manifestPath] : []), ...embeds.keys()])) {
    if (files.has(target)) continue; // a verbatim capture of the whole file wins
    const base =
      target === manifestPath && ecosystem
        ? baseManifest(ecosystem, projectName, pattern, workspaceParents)
        : {};
    if (typeof base === "string") {
      files.set(target, base); // go.mod is line-oriented, not a table tree
      continue;
    }
    for (const embed of embeds.get(target) ?? []) {
      if (!isSafeDottedPath(embed.dotted)) {
        notes.push(`Config source "${target}#${embed.dotted}" is not a safe key path; skipped.`);
        continue;
      }
      try {
        setDeep(base, embed.dotted, parseByExtension(target, embed.contents));
      } catch {
        notes.push(`Captured config for ${target}#${embed.dotted} could not be parsed; skipped.`);
      }
    }
    files.set(target, serializeByExtension(target, base));
  }

  // --- Commands: into the taskfile the pattern prescribes ------------------
  const runner = pattern.toolchain?.taskRunner;
  if (pattern.commands && (runner === "just" || runner === "make")) {
    const target = runner === "just" ? "justfile" : "Makefile";
    if (files.has(target)) {
      // A captured config owns the taskfile: its bytes beat generated ones.
      notes.push(`A captured config already owns ${target}; the commands facet was not written.`);
    } else if (runner === "just") {
      files.set(target, taskfile(pattern.commands, "  "));
    } else {
      const verbs = Object.keys(pattern.commands).join(" ");
      files.set(target, `.PHONY: ${verbs}\n\n${taskfile(pattern.commands, "\t")}`);
    }
  }

  // --- CHANGELOG stamping --------------------------------------------------
  if (pattern.releases?.changelog === "keep-a-changelog" && !files.has("CHANGELOG.md")) {
    files.set("CHANGELOG.md", renderChangelog(pattern.releases));
  }

  // --- LICENSE stamping ----------------------------------------------------
  const licenseFile =
    layoutFiles.find((f) => LICENSE_FILE.test(f)) ?? (pattern.license ? "LICENSE" : undefined);
  if (licenseFile && pattern.license && captured.has(licenseFile)) {
    notes.push(`A captured config already owns ${licenseFile}; the license was not stamped.`);
  } else if (licenseFile && pattern.license) {
    const text = renderLicense(pattern.license, `the ${projectName} authors`);
    if (text) files.set(licenseFile, text);
    else {
      files.set(
        licenseFile,
        `This project is licensed under ${pattern.license}.\n\nReplace this file with the full license text: https://spdx.org/licenses/\n`,
      );
      notes.push(
        `dolly has no stored text for ${pattern.license}; ${licenseFile} is a placeholder.`,
      );
    }
  }

  // --- Templates: the captured shape of each {name} file, instantiated -----
  // Precedence: a captured config keeps its own bytes, a template beats
  // anything dolly generates, and a generic stub is the last resort.
  for (const target of pattern.scaffold?.templates ?? []) {
    // The project name is a slug, so a safe target stays safe once expanded.
    if (!isSafePatternPath(target)) {
      notes.push(`Template path "${target}" is not a safe relative path; skipped.`);
      continue;
    }
    const expanded = expandName(target, projectName, pattern.naming);
    if (!expanded) continue; // per-resource template: nothing to name it after yet
    if (captured.has(expanded)) {
      notes.push(`Template ${target} skipped: a captured config already owns ${expanded}.`);
      continue;
    }
    const raw = await pathWithin(patternDir, `templates/${target}`).then(
      readIfExists,
      () => undefined,
    );
    if (raw === undefined) {
      notes.push(`Template ${target} is missing from the pattern; ${expanded} not written.`);
      continue;
    }
    const contents = raw.replaceAll("{{name}}", projectName).replaceAll("{{project}}", projectName);
    files.set(expanded, contents);
  }

  // --- Remaining layout files: readme, gitignore, stubs, empty -------------
  for (const path of layoutFiles) {
    if (files.has(path)) continue;
    files.set(path, stubContents(path, projectName, patternName, pattern, ecosystem));
  }
  if (ecosystem && !files.has(".gitignore")) files.set(".gitignore", gitignoreFor(ecosystem));
  seedStarterFiles(dirs, files, pattern, ecosystem);

  // The marker `dolly check` resolves the pattern from; meant to be committed.
  if (!files.has(".dolly")) files.set(".dolly", markerContents({ pattern: patternName }));

  // --- Write everything ----------------------------------------------------
  await writeTree(root, dirs, files, notes);
  await gitInit(root, notes);

  if (pattern.dependencies?.versionPolicy === "pinned" && ecosystem !== "npm") {
    notes.push(
      "The pinned version policy shapes npm install steps only. Pin the printed installs by hand.",
    );
  }
  const created = [...[...dirs].map((d) => `${d}/`), ...files.keys()].sort(comparePaths);
  return {
    root,
    projectName,
    created,
    skipped: skipped.sort(comparePaths),
    notes,
    nextSteps: nextSteps(targetDir, pattern, ecosystem, typesPackages(files.get("tsconfig.json"))),
  };
}

/**
 * Puts the planned tree on disk: directories first, then files, then a
 * `.gitkeep` in whatever stayed empty so git can carry it. `dirs` and `files`
 * are the plan, and both are mutated to match what was actually written.
 */
async function writeTree(
  root: string,
  dirs: Set<string>,
  files: Map<string, string>,
  notes: string[],
): Promise<void> {
  // A pattern can name one path as both a file and a directory: in dirs
  // outright, or implicitly as another file's parent. Writing the file would
  // fail partway through the tree, so the directory wins.
  const parents = new Set<string>();
  for (const file of files.keys()) {
    for (let dir = dirname(file); dir !== "." && !parents.has(dir); dir = dirname(dir)) {
      parents.add(dir);
    }
  }
  for (const path of [...files.keys()]) {
    if (
      dirs.has(path) ||
      parents.has(path) ||
      [...dirs].some((dir) => dir.startsWith(`${path}/`))
    ) {
      files.delete(path);
      notes.push(`"${path}" is both a file and a directory in this pattern; kept the directory.`);
    }
  }
  dirs.delete(".");

  await mkdir(root, { recursive: true });
  for (const dir of dirs) await mkdir(join(root, dir), { recursive: true });
  for (const [path, contents] of files) {
    await mkdir(join(root, dirname(path)), { recursive: true });
    await writeFile(join(root, path), contents);
  }

  for (const dir of dirs) {
    const occupied =
      [...files.keys()].some((f) => f.startsWith(`${dir}/`)) ||
      [...dirs].some((d) => d !== dir && d.startsWith(`${dir}/`));
    if (!occupied) {
      await writeFile(join(root, dir, ".gitkeep"), "");
      files.set(`${dir}/.gitkeep`, "");
    }
  }
}

/** The target may exist only as an empty directory. */
async function assertEmptyTarget(root: string): Promise<void> {
  try {
    if ((await readdir(root)).length > 0) throw new TargetNotEmptyError(root);
  } catch (error) {
    if (error instanceof TargetNotEmptyError) throw error;
    // ENOENT: nothing there yet, which is the happy path. ENOTDIR: a file
    // sits where the project should go, which mkdir will refuse loudly.
    // Anything else (EACCES on an unreadable directory) must not read as
    // "empty", since that would overwrite files dolly could not see.
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
  }
}

function baseManifest(
  ecosystem: Ecosystem,
  projectName: string,
  pattern: Pattern,
  workspaceParents: string[],
): Record<string, unknown> | string {
  const versions = pattern.languages?.versions ?? {};
  const runner = pattern.toolchain?.taskRunner;
  const workspaces = workspaceParents.map((parent) => `${parent}/*`);

  if (ecosystem === "npm") {
    const engines = Object.fromEntries(
      Object.entries(versions).filter(([runtime]) => NPM_ENGINES.has(runtime)),
    );
    return {
      name: projectName,
      version: "0.1.0",
      ...(workspaces.length > 0 ? { private: true } : {}),
      description: "",
      ...(pattern.license ? { license: pattern.license } : {}),
      type: "module",
      ...(workspaces.length > 0 ? { workspaces } : {}),
      ...(pattern.commands && runner !== "just" && runner !== "make"
        ? { scripts: pattern.commands }
        : {}),
      ...(Object.keys(engines).length > 0 ? { engines } : {}),
    };
  }
  if (ecosystem === "pypi") {
    const python = versions.python;
    return {
      project: {
        name: projectName,
        version: "0.1.0",
        description: "",
        ...(pattern.license ? { license: pattern.license } : {}),
        // A bare pin like "3.12" needs an operator to be a valid specifier.
        ...(python ? { "requires-python": /^\d/.test(python) ? `>=${python}` : python } : {}),
      },
    };
  }
  if (ecosystem === "cargo") {
    return {
      package: {
        name: projectName,
        version: "0.1.0",
        edition: "2021",
        ...(pattern.license ? { license: pattern.license } : {}),
        ...(versions.rust ? { "rust-version": barePin(versions.rust) } : {}),
      },
      ...(workspaces.length > 0 ? { workspace: { members: workspaces } } : {}),
      dependencies: {},
    };
  }
  if (ecosystem === "go") {
    return `module ${projectName}\n${versions.go ? `\ngo ${barePin(versions.go)}\n` : ""}`;
  }
  if (ecosystem === "rubygems") {
    const ruby = versions.ruby ? `\nruby "${barePin(versions.ruby)}"\n` : "";
    return `source "https://rubygems.org"\n${ruby}`;
  }
  if (ecosystem === "maven") {
    const java = versions.java ? barePin(versions.java) : undefined;
    if (pattern.toolchain?.packageManager === "gradle") {
      const toolchain = java
        ? `\njava {\n    toolchain {\n        languageVersion = JavaLanguageVersion.of(${java})\n    }\n}\n`
        : "";
      return `plugins {\n    java\n}\n\ngroup = "${javaGroup(projectName)}"\nversion = "0.1.0"\n\nrepositories {\n    mavenCentral()\n}\n${toolchain}`;
    }
    const properties = [
      ...(java ? [`    <maven.compiler.release>${java}</maven.compiler.release>`] : []),
      "    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>",
    ].join("\n");
    const license = pattern.license
      ? `  <licenses>\n    <license>\n      <name>${pattern.license}</name>\n    </license>\n  </licenses>\n`
      : "";
    return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>${javaGroup(projectName)}</groupId>
  <artifactId>${projectName}</artifactId>
  <version>0.1.0</version>
  <packaging>jar</packaging>
  <properties>
${properties}
  </properties>
${license}</project>
`;
  }
  if (ecosystem === "composer") {
    const php = versions.php;
    return {
      name: `${projectName}/${projectName}`,
      description: "",
      type: "project",
      ...(pattern.license ? { license: pattern.license } : {}),
      require: { ...(php ? { php: /^\d/.test(php) ? `>=${php}` : php } : {}) },
      autoload: { "psr-4": { "App\\": "src/" } },
    };
  }
  // nuget: the project file, named after the project; the SDK pin becomes the target framework.
  const sdk = versions.dotnet ? barePin(versions.dotnet).match(/^(\d+)\.(\d+)/) : null;
  const framework = sdk ? `    <TargetFramework>net${sdk[1]}.${sdk[2]}</TargetFramework>\n` : "";
  return `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>Exe</OutputType>
${framework}    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>

</Project>
`;
}

/** Where the base manifest goes: the ecosystem's file, the Gradle build file when the pattern says Gradle, the project file named after the project on .NET. */
function manifestPathOf(ecosystem: Ecosystem, pattern: Pattern, projectName: string): string {
  if (ecosystem === "maven" && pattern.toolchain?.packageManager === "gradle")
    return "build.gradle.kts";
  return MANIFEST_OF[ecosystem].replaceAll("{name}", projectName);
}

/** A reverse-domain group for a project name: "my-service" reads as "dev.myservice". */
function javaGroup(projectName: string): string {
  return `dev.${projectName.replace(/[^a-z0-9]/g, "")}`;
}

/**
 * `go` and `rust-version` take a bare version, so a pin carrying a specifier's
 * operator (">=1.21") loses it, the inverse of the operator `requires-python`
 * gains above.
 */
function barePin(version: string): string {
  return version.replace(/^[^\d]+/, "") || version;
}

/**
 * Empty src/ and test/ directories get one starter file each, so the
 * scaffold's canonical commands (typecheck, test…) pass on day one instead
 * of erroring on an empty tree. The test runner owns the seed's contents;
 * the testing facet owns its name and placement: a colocated pattern seeds
 * next to the entry file, since its layout carries no test directory.
 */
function seedStarterFiles(
  dirs: Set<string>,
  files: Map<string, string>,
  pattern: Pattern,
  ecosystem: Ecosystem | undefined,
): void {
  const language = pattern.languages?.programming?.[0];
  const colocated = pattern.testing?.placement === "colocated";
  const seed = testSeed(pattern.toolchain?.testRunner, language, pattern.testing);
  // Empty subdirectories don't count as content: src/ holding only an empty
  // commands/ still needs an entry file for the typechecker to have inputs.
  const empty = (dir: string) => ![...files.keys()].some((f) => f.startsWith(`${dir}/`));

  for (const dir of [...dirs].sort(comparePaths)) {
    const base = basename(dir);
    if (base === "src" && empty(dir)) {
      const entry = language === "TypeScript" || language === "JavaScript";
      if (language === "TypeScript") files.set(`${dir}/index.ts`, "export {};\n");
      else if (language === "JavaScript") files.set(`${dir}/index.js`, "export {};\n");
      else if (ecosystem === "cargo") files.set(`${dir}/main.rs`, "fn main() {}\n");
      if (entry && colocated && seed) files.set(`${dir}/${seed.name}`, seed.contents);
    } else if (TEST_ROOT_NAMES.has(base) && empty(dir) && !colocated) {
      if (seed) files.set(`${dir}/${seed.name}`, seed.contents);
    }
  }
}

function testSeed(
  runner: string | undefined,
  language: string | undefined,
  testing: Pattern["testing"],
): { name: string; contents: string } | undefined {
  const ext = language === "JavaScript" ? "js" : "ts";
  // The facet's filePattern names the seed ("{stem}.spec.ts" → "index.spec.ts"),
  // so a fresh scaffold passes its own pattern's testing rule.
  const named = (stem: string, fallback: string) =>
    testing?.filePattern?.includes("{stem}")
      ? testing.filePattern.replaceAll("{stem}", stem)
      : fallback;
  const body = 'test("scaffold", () => {\n  expect(true).toBe(true);\n});\n';
  if (runner === "bun-test")
    return {
      name: named("index", `index.test.${ext}`),
      contents: `import { expect, test } from "bun:test";\n\n${body}`,
    };
  if (runner === "vitest")
    return {
      name: named("index", `index.test.${ext}`),
      contents: `import { expect, test } from "vitest";\n\n${body}`,
    };
  if (runner === "jest") return { name: named("index", `index.test.${ext}`), contents: body };
  if (runner === "node-test") {
    return {
      name: named("index", `index.test.${ext}`),
      contents:
        'import assert from "node:assert";\nimport { test } from "node:test";\n\ntest("scaffold", () => {\n  assert.ok(true);\n});\n',
    };
  }
  if (runner === "pytest")
    return {
      name: named("scaffold", "test_scaffold.py"),
      contents: "def test_scaffold() -> None:\n    assert True\n",
    };
  if (runner === "rspec")
    return {
      name: named("scaffold", "scaffold_spec.rb"),
      contents:
        'RSpec.describe "scaffold" do\n  it "runs" do\n    expect(true).to be(true)\n  end\nend\n',
    };
  if (runner === "minitest")
    return {
      name: named("scaffold", "scaffold_test.rb"),
      contents:
        'require "minitest/autorun"\n\nclass ScaffoldTest < Minitest::Test\n  def test_scaffold\n    assert true\n  end\nend\n',
    };
  if (runner === "phpunit" || runner === "pest")
    return {
      name: named("Scaffold", "ScaffoldTest.php"),
      contents:
        runner === "pest"
          ? "<?php\n\ntest('scaffold', function () {\n    expect(true)->toBeTrue();\n});\n"
          : "<?php\n\nuse PHPUnit\\Framework\\TestCase;\n\nfinal class ScaffoldTest extends TestCase\n{\n    public function testScaffold(): void\n    {\n        $this->assertTrue(true);\n    }\n}\n",
    };
  return undefined;
}

/** `types` entries in a scaffolded tsconfig resolve from @types/*; install them too. */
function typesPackages(tsconfig: string | undefined): string[] {
  if (!tsconfig) return [];
  try {
    const types = (JSON.parse(tsconfig) as { compilerOptions?: { types?: string[] } })
      .compilerOptions?.types;
    return (types ?? [])
      .filter((t) => typeof t === "string" && !t.includes("/") && !t.startsWith("@"))
      .map((t) => `@types/${t}`);
  } catch {
    return [];
  }
}

function nextSteps(
  targetDir: string,
  pattern: Pattern,
  ecosystem: Ecosystem | undefined,
  extraDev: string[],
): string[] {
  const steps = [`cd ${targetDir}`];
  const deps = pattern.dependencies;
  const pinned = deps?.versionPolicy === "pinned";
  const runtime = installNames(Object.values(deps?.runtime ?? {}));
  const dev = installNames([
    ...Object.values(deps?.dev ?? {}),
    ...(ecosystem === "npm" ? extraDev : []),
  ]);

  if (ecosystem === "npm") {
    const pm = pattern.toolchain?.packageManager ?? "npm";
    const add = pm === "npm" ? "npm install" : `${pm} add`;
    const exact = pinned ? (pm === "bun" || pm === "yarn" ? " --exact" : " --save-exact") : "";
    if (runtime.length > 0) steps.push(`${add}${exact} ${runtime.join(" ")}`);
    if (dev.length > 0) steps.push(`${add}${exact} -D ${dev.join(" ")}`);
    if (runtime.length === 0 && dev.length === 0) steps.push(`${pm} install`);
  } else if (ecosystem === "pypi") {
    const pm = pattern.toolchain?.packageManager;
    const [add, devFlag] =
      pm === "uv"
        ? ["uv add", "--dev "]
        : pm === "poetry"
          ? ["poetry add", "--group dev "]
          : ["pip install", ""];
    if (runtime.length > 0) steps.push(`${add} ${runtime.join(" ")}`);
    if (dev.length > 0) steps.push(`${add} ${devFlag}${dev.join(" ")}`);
  } else if (ecosystem === "cargo") {
    if (runtime.length > 0) steps.push(`cargo add ${runtime.join(" ")}`);
    if (dev.length > 0) steps.push(`cargo add --dev ${dev.join(" ")}`);
  } else if (ecosystem === "go") {
    for (const dep of [...runtime, ...dev]) steps.push(`go get ${dep}`);
  } else if (ecosystem === "rubygems") {
    if (runtime.length > 0) steps.push(`bundle add ${runtime.join(" ")}`);
    if (dev.length > 0) steps.push(`bundle add --group development,test ${dev.join(" ")}`);
    if (runtime.length === 0 && dev.length === 0) steps.push("bundle install");
  } else if (ecosystem === "maven") {
    // Neither Maven nor Gradle adds a dependency from the command line.
    const file = pattern.toolchain?.packageManager === "gradle" ? "build.gradle.kts" : "pom.xml";
    if (runtime.length > 0) steps.push(`add to ${file}: ${runtime.join(", ")}`);
    if (dev.length > 0) steps.push(`add to ${file} (test scope): ${dev.join(", ")}`);
  } else if (ecosystem === "composer") {
    if (runtime.length > 0) steps.push(`composer require ${runtime.join(" ")}`);
    if (dev.length > 0) steps.push(`composer require --dev ${dev.join(" ")}`);
    if (runtime.length === 0 && dev.length === 0) steps.push("composer install");
  } else if (ecosystem === "nuget") {
    for (const dep of [...runtime, ...dev]) steps.push(`dotnet add package ${dep}`);
  }

  steps.push('git add -A && git commit -m "scaffold"');
  return steps;
}

/** Library names are installable as-is; a few tools are published under another name. */
function installNames(names: string[]): string[] {
  return [...new Set(names.map((name) => INSTALL_NAME[name] ?? name))].sort();
}

/**
 * A `{name}` directory segment is a module template: it instantiates once,
 * named after the project. A `{name}` in file position (routers/{name}.py) is
 * a per-resource convention with no instance to name yet, so it has no
 * expansion, and the caller reports it as skipped.
 */
function expandName(
  path: string,
  projectName: string,
  naming: Pattern["naming"],
): string | undefined {
  if (!path.includes("{name}")) return path;
  // Only a directory segment ("{name}/…") instantiates; a bare "{name}" is a
  // file at the root, which is as per-resource as "routers/{name}.py".
  if (!path.includes("{name}/")) return undefined;
  // The instance takes the pattern's own case per position: a snake_case
  // pattern scaffolded as "MyCoolApp" must not violate its own naming rule.
  const isDirPath = path.endsWith("/");
  const segments = path.split("/");
  return segments
    .map((segment, i) => {
      if (!segment.includes("{name}")) return segment;
      const filePosition = !isDirPath && i === segments.length - 1;
      const style = filePosition
        ? (naming?.extensions[extensionOf(segment) ?? ""] ?? naming?.files)
        : naming?.directories;
      return segment.replaceAll("{name}", style ? renderStem(projectName, style) : projectName);
    })
    .join("/");
}

/** Best-effort `git init`; a machine without git gets a note, not a crash. */
async function gitInit(root: string, notes: string[]): Promise<void> {
  try {
    const proc = Bun.spawn(["git", "init", "--quiet"], {
      cwd: root,
      stdout: "ignore",
      stderr: "ignore",
    });
    if ((await proc.exited) !== 0)
      notes.push("git init failed; initialize the repository yourself.");
  } catch {
    notes.push("git is not installed; initialize the repository yourself.");
  }
}
