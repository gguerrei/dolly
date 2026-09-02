import { join } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { stringify as stringifyToml } from "smol-toml";
import type { Toolchain } from "../pattern/schema";
import { scanRecipes, TASKFILE_NAMES } from "../taskfile";
import { parseTomlSafe, readJsonSafe } from "../tree/files";
import { type Inventory, rootFiles as rootEvidenceFiles } from "../tree/inventory";
import { hasMachinePath } from "./capture";
import type { Ecosystem } from "./registry";
import { detectReleaseTool } from "./releases";

/**
 * Detects the tools a project is built with from structural fingerprints
 * (config files, manifest sections, lockfiles) and captures their configs as
 * files under the pattern's toolchain/ directory. Facet roles come from the
 * primary ecosystem; secondary ecosystems degrade to one prose note each.
 */
export const TOOLCHAIN_TUNING = {
  /** Configs above this size are noted, never captured. */
  maxCaptureBytes: 256 * 1024,
};

type Role = "packageManager" | "formatter" | "linter" | "typechecker" | "testRunner" | "taskRunner";

interface Candidate {
  tool: string;
  role: Role;
  ecosystem: Ecosystem | "any";
  evidence: string;
  /** Repo path or "manifest#dotted.path"; it becomes the configs key. */
  sourceId?: string;
  /** Pattern-relative target plus contents, when the config is capturable. */
  capture?: { file: string; contents: string };
}

export interface ToolchainScan {
  toolchain?: Toolchain;
  /** Pattern-relative path → contents, written next to pattern.md. */
  files: Record<string, string>;
  notes: string[];
}

export async function scanToolchain(
  inventory: Inventory,
  primary: Ecosystem | undefined,
): Promise<ToolchainScan> {
  const notes: string[] = [];
  // Lockfiles are merged here because they are toolchain-only evidence.
  const rootFiles = new Set([
    ...rootEvidenceFiles(inventory),
    ...inventory.lockfiles.filter((path) => !path.includes("/")),
  ]);
  const read = (name: string) => Bun.file(join(inventory.root, name)).text();
  const packageJson = rootFiles.has("package.json")
    ? await readJsonSafe(join(inventory.root, "package.json"))
    : undefined;
  const pyproject = rootFiles.has("pyproject.toml")
    ? await readTomlSafe(join(inventory.root, "pyproject.toml"), notes)
    : undefined;
  const scripts = Object.values(
    (packageJson?.scripts as Record<string, string> | undefined) ?? {},
  ).join("\n");
  const devDeps = {
    ...((packageJson?.devDependencies as Record<string, string> | undefined) ?? {}),
  };

  const candidates: Candidate[] = [];
  const found = (
    tool: string,
    role: Role,
    ecosystem: Ecosystem | "any",
    evidence: string,
    sourceId?: string,
    contents?: string,
  ) => {
    const candidate: Candidate = { tool, role, ecosystem, evidence, sourceId };
    if (sourceId && contents !== undefined)
      candidate.capture = gatedCapture(sourceId, contents, notes);
    candidates.push(candidate);
  };

  /** First existing root file wins, encoding the tool's own resolution order. */
  const firstFile = (names: string[]) => names.find((n) => rootFiles.has(n));

  // --- JS ---------------------------------------------------------------
  if (packageJson || firstFile(["deno.json", "deno.jsonc"])) {
    const pm = (packageJson?.packageManager as string | undefined) ?? "";
    if (firstFile(["bun.lock", "bun.lockb"]) || pm.startsWith("bun@"))
      found("bun", "packageManager", "npm", "bun lockfile");
    if (rootFiles.has("pnpm-lock.yaml") || pm.startsWith("pnpm@"))
      found("pnpm", "packageManager", "npm", "pnpm lockfile");
    if (rootFiles.has("yarn.lock") || pm.startsWith("yarn@"))
      found("yarn", "packageManager", "npm", "yarn lockfile");
    if (firstFile(["package-lock.json", "npm-shrinkwrap.json"]) || pm.startsWith("npm@"))
      found("npm", "packageManager", "npm", "npm lockfile");

    const biomeFile = firstFile(["biome.json", "biome.jsonc"]);
    if (biomeFile) {
      const contents = await read(biomeFile);
      const parsed = parseJsonc(contents) as
        | { formatter?: { enabled?: boolean }; linter?: { enabled?: boolean } }
        | undefined;
      if (parsed?.formatter?.enabled !== false)
        found("biome", "formatter", "npm", biomeFile, biomeFile, contents);
      if (parsed?.linter?.enabled !== false)
        found("biome", "linter", "npm", biomeFile, biomeFile, contents);
    }
    const prettierFile = firstFile([
      ".prettierrc",
      ".prettierrc.json",
      ".prettierrc.yml",
      ".prettierrc.yaml",
      ".prettierrc.json5",
      ".prettierrc.js",
      ".prettierrc.cjs",
      ".prettierrc.mjs",
      ".prettierrc.toml",
      "prettier.config.js",
      "prettier.config.cjs",
      "prettier.config.mjs",
      "prettier.config.ts",
    ]);
    if (prettierFile)
      found("prettier", "formatter", "npm", prettierFile, prettierFile, await read(prettierFile));
    else if (packageJson?.prettier !== undefined)
      found(
        "prettier",
        "formatter",
        "npm",
        'package.json "prettier"',
        "package.json#prettier",
        `${JSON.stringify(packageJson.prettier, null, 2)}\n`,
      );

    const eslintFile = firstFile([
      "eslint.config.js",
      "eslint.config.mjs",
      "eslint.config.cjs",
      "eslint.config.ts",
      ".eslintrc",
      ".eslintrc.json",
      ".eslintrc.js",
      ".eslintrc.cjs",
      ".eslintrc.yml",
      ".eslintrc.yaml",
    ]);
    if (eslintFile)
      found("eslint", "linter", "npm", eslintFile, eslintFile, await read(eslintFile));
    else if (packageJson?.eslintConfig !== undefined)
      found("eslint", "linter", "npm", 'package.json "eslintConfig"');

    if (rootFiles.has("tsconfig.json")) {
      const compilerOptions = (
        parseJsonc(await read("tsconfig.json")) as { compilerOptions?: unknown } | undefined
      )?.compilerOptions;
      found(
        "tsc",
        "typechecker",
        "npm",
        "tsconfig.json",
        "tsconfig.json#compilerOptions",
        compilerOptions ? `${JSON.stringify(compilerOptions, null, 2)}\n` : undefined,
      );
    }

    const vitestFile = firstFile([
      "vitest.config.ts",
      "vitest.config.js",
      "vitest.config.mts",
      "vitest.config.mjs",
    ]);
    if (vitestFile)
      found("vitest", "testRunner", "npm", vitestFile, vitestFile, await read(vitestFile));
    const jestFile = firstFile([
      "jest.config.js",
      "jest.config.ts",
      "jest.config.cjs",
      "jest.config.mjs",
      "jest.config.json",
    ]);
    if (jestFile) found("jest", "testRunner", "npm", jestFile, jestFile, await read(jestFile));
    else if (packageJson?.jest !== undefined)
      found("jest", "testRunner", "npm", 'package.json "jest"');
    // Configless runners need two independent structural signals.
    for (const runner of ["vitest", "jest", "mocha", "ava"]) {
      if (
        !candidates.some((c) => c.tool === runner) &&
        new RegExp(`\\b${runner}\\b`).test(scripts) &&
        runner in devDeps
      ) {
        found(runner, "testRunner", "npm", `invoked in scripts and declared in devDependencies`);
      }
    }
    // Built-in runners have no config to find; they count only when nothing else claims the role.
    if (!candidates.some((c) => c.role === "testRunner" && c.ecosystem === "npm")) {
      if (/\bbun test\b/.test(scripts))
        found("bun-test", "testRunner", "npm", 'scripts run "bun test"');
      else if (/\bnode --test\b/.test(scripts))
        found("node-test", "testRunner", "npm", 'scripts run "node --test"');
    }

    const scriptNames = Object.keys(
      (packageJson?.scripts as Record<string, string> | undefined) ?? {},
    );
    if (scriptNames.length > 0) {
      found("npm-scripts", "taskRunner", "npm", "package.json scripts");
      notes.push(`package.json scripts: ${scriptNames.sort().join(", ")}.`);
    }
  }

  // --- Python -----------------------------------------------------------
  const pythonPresent =
    pyproject ||
    firstFile(["setup.py", "setup.cfg", "Pipfile", "requirements.txt", "requirements.in"]);
  if (pythonPresent) {
    const tool = (pyproject?.tool as Record<string, unknown> | undefined) ?? {};
    if (rootFiles.has("uv.lock") || tool.uv)
      found("uv", "packageManager", "pypi", "uv lockfile or [tool.uv]");
    if (rootFiles.has("poetry.lock") || tool.poetry)
      found("poetry", "packageManager", "pypi", "poetry lockfile or [tool.poetry]");
    if (rootFiles.has("pdm.lock") || tool.pdm)
      found("pdm", "packageManager", "pypi", "pdm lockfile or [tool.pdm]");
    if (rootFiles.has("Pipfile.lock") || rootFiles.has("Pipfile"))
      found("pipenv", "packageManager", "pypi", "Pipfile");
    if (
      !candidates.some((c) => c.role === "packageManager" && c.ecosystem === "pypi") &&
      firstFile(["requirements.txt", "requirements.in"])
    ) {
      found("pip", "packageManager", "pypi", "requirements file");
    }

    const ruffFile = firstFile(["ruff.toml", ".ruff.toml"]);
    const ruffTable = tool.ruff as Record<string, unknown> | undefined;
    if (ruffFile) {
      const contents = await read(ruffFile);
      found("ruff", "linter", "pypi", ruffFile, ruffFile, contents);
      if ((parseTomlSafe(contents)?.format as unknown) !== undefined)
        found("ruff-format", "formatter", "pypi", `[format] in ${ruffFile}`);
    } else if (ruffTable) {
      found(
        "ruff",
        "linter",
        "pypi",
        "[tool.ruff]",
        "pyproject.toml#tool.ruff",
        `${stringifyToml(ruffTable)}\n`,
      );
      if (ruffTable.format !== undefined)
        found("ruff-format", "formatter", "pypi", "[tool.ruff.format]");
    }
    if (tool.black)
      found(
        "black",
        "formatter",
        "pypi",
        "[tool.black]",
        "pyproject.toml#tool.black",
        `${stringifyToml(tool.black as Record<string, unknown>)}\n`,
      );
    if (rootFiles.has(".flake8"))
      found("flake8", "linter", "pypi", ".flake8", ".flake8", await read(".flake8"));
    const mypyFile = firstFile(["mypy.ini", ".mypy.ini"]);
    if (mypyFile) found("mypy", "typechecker", "pypi", mypyFile, mypyFile, await read(mypyFile));
    else if (tool.mypy)
      found(
        "mypy",
        "typechecker",
        "pypi",
        "[tool.mypy]",
        "pyproject.toml#tool.mypy",
        `${stringifyToml(tool.mypy as Record<string, unknown>)}\n`,
      );
    if (rootFiles.has("pyrightconfig.json"))
      found(
        "pyright",
        "typechecker",
        "pypi",
        "pyrightconfig.json",
        "pyrightconfig.json",
        await read("pyrightconfig.json"),
      );
    else if (tool.pyright) found("pyright", "typechecker", "pypi", "[tool.pyright]");
    const pytestFile = firstFile(["pytest.ini", ".pytest.ini"]);
    if (pytestFile)
      found("pytest", "testRunner", "pypi", pytestFile, pytestFile, await read(pytestFile));
    else if ((tool.pytest as { ini_options?: unknown } | undefined)?.ini_options)
      found("pytest", "testRunner", "pypi", "[tool.pytest.ini_options]");
  }

  // --- Rust / Go --------------------------------------------------------
  if (rootFiles.has("Cargo.toml")) {
    found("cargo", "packageManager", "cargo", "Cargo.toml");
    const rustfmtFile = firstFile(["rustfmt.toml", ".rustfmt.toml"]);
    found(
      "rustfmt",
      "formatter",
      "cargo",
      "Rust toolchain default",
      rustfmtFile,
      rustfmtFile ? await read(rustfmtFile) : undefined,
    );
    const clippyFile = firstFile(["clippy.toml", ".clippy.toml"]);
    if (clippyFile)
      found("clippy", "linter", "cargo", clippyFile, clippyFile, await read(clippyFile));
  }
  if (rootFiles.has("go.mod")) {
    found("go-modules", "packageManager", "go", "go.mod");
    found("gofmt", "formatter", "go", "Go toolchain default");
    const golangci = firstFile([
      ".golangci.yml",
      ".golangci.yaml",
      ".golangci.toml",
      ".golangci.json",
    ]);
    if (golangci) found("golangci-lint", "linter", "go", golangci, golangci, await read(golangci));
  }

  // --- Ruby -------------------------------------------------------------
  if (rootFiles.has("Gemfile")) {
    const gemfile = await read("Gemfile");
    found("bundler", "packageManager", "rubygems", "Gemfile");
    const rubocop = firstFile([".rubocop.yml", ".rubocop.yaml"]);
    if (rubocop) {
      const contents = await read(rubocop);
      found("rubocop", "formatter", "rubygems", rubocop, rubocop, contents);
      found("rubocop", "linter", "rubygems", rubocop, rubocop, contents);
    }
    if (rootFiles.has(".rspec") || /\brspec\b/.test(gemfile)) {
      found("rspec", "testRunner", "rubygems", rootFiles.has(".rspec") ? ".rspec" : "Gemfile");
    } else if (/\bminitest\b/.test(gemfile) || inventory.dirs.includes("test")) {
      found("minitest", "testRunner", "rubygems", "Gemfile or test/");
    }
  }

  // --- JVM --------------------------------------------------------------
  const gradleFile = firstFile(["build.gradle.kts", "build.gradle"]);
  if (rootFiles.has("pom.xml") || gradleFile) {
    const build = await read(rootFiles.has("pom.xml") ? "pom.xml" : (gradleFile as string));
    if (rootFiles.has("pom.xml")) found("maven", "packageManager", "maven", "pom.xml");
    if (gradleFile) found("gradle", "packageManager", "maven", gradleFile);
    const checkstyle = firstFile(["checkstyle.xml"]);
    if (checkstyle)
      found("checkstyle", "linter", "maven", checkstyle, checkstyle, await read(checkstyle));
    const detekt = firstFile(["detekt.yml", "detekt.yaml"]);
    if (detekt) found("detekt", "linter", "maven", detekt, detekt, await read(detekt));
    if (/junit/i.test(build)) found("junit", "testRunner", "maven", "junit in the build file");
    else if (/kotest/i.test(build))
      found("kotest", "testRunner", "maven", "kotest in the build file");
  }

  // --- PHP --------------------------------------------------------------
  if (rootFiles.has("composer.json")) {
    const composer = (await readJsonSafe(join(inventory.root, "composer.json"))) ?? {};
    const devRequires = Object.keys(
      (composer["require-dev"] as Record<string, string> | undefined) ?? {},
    );
    found("composer", "packageManager", "composer", "composer.json");
    const fixer = firstFile([".php-cs-fixer.dist.php", ".php-cs-fixer.php"]);
    if (fixer) found("php-cs-fixer", "formatter", "composer", fixer, fixer, await read(fixer));
    else if (rootFiles.has("pint.json"))
      found("pint", "formatter", "composer", "pint.json", "pint.json", await read("pint.json"));
    const phpstan = firstFile(["phpstan.neon", "phpstan.neon.dist", "phpstan.dist.neon"]);
    if (phpstan) found("phpstan", "linter", "composer", phpstan, phpstan, await read(phpstan));
    const psalm = firstFile(["psalm.xml", "psalm.xml.dist"]);
    if (psalm) found("psalm", "linter", "composer", psalm, psalm, await read(psalm));
    const phpunit = firstFile(["phpunit.xml", "phpunit.xml.dist", "phpunit.dist.xml"]);
    if (devRequires.includes("pestphp/pest"))
      found("pest", "testRunner", "composer", "pestphp/pest in require-dev");
    else if (phpunit)
      found("phpunit", "testRunner", "composer", phpunit, phpunit, await read(phpunit));
    else if (devRequires.includes("phpunit/phpunit"))
      found("phpunit", "testRunner", "composer", "phpunit/phpunit in require-dev");
  }

  // --- .NET -------------------------------------------------------------
  const projectFiles = inventory.files.filter((f) => /\.(csproj|fsproj|vbproj)$/i.test(f.path));
  if (projectFiles.length > 0) {
    found("nuget", "packageManager", "nuget", projectFiles[0]?.path as string);
    found("dotnet-format", "formatter", "nuget", ".NET SDK default");
    const sources = await Promise.all(projectFiles.map((f) => read(f.path)));
    const references = sources.join("\n");
    for (const [runner, id] of [
      ["xunit", "xunit"],
      ["nunit", "NUnit"],
      ["mstest", "MSTest.TestFramework"],
    ] as const) {
      if (new RegExp(`Include="${id}"`, "i").test(references)) {
        found(runner, "testRunner", "nuget", `${id} referenced by a project`);
        break;
      }
    }
  }

  // --- Cross-ecosystem --------------------------------------------------
  for (const runner of ["make", "just"] as const) {
    const taskfile = firstFile(TASKFILE_NAMES[runner]);
    if (!taskfile) continue;
    found(runner, "taskRunner", "any", taskfile);
    const names = [...new Set(scanRecipes(await read(taskfile), runner).map((r) => r.name))];
    notes.push(`${taskfile} targets: ${names.sort().join(", ") || "(none found)"}.`);
  }

  // --- Resolve roles (primary ecosystem + cross-ecosystem rows) --------
  const facet: Toolchain = { configs: {}, binding: {} };
  const files: Record<string, string> = {};
  const inPlay = candidates.filter((c) => c.ecosystem === "any" || c.ecosystem === primary);
  const secondary = candidates.filter((c) => c.ecosystem !== "any" && c.ecosystem !== primary);

  for (const role of [
    "packageManager",
    "formatter",
    "linter",
    "typechecker",
    "testRunner",
    "taskRunner",
  ] as const) {
    const contenders = dedupe(inPlay.filter((c) => c.role === role));
    const winner = resolveRole(role, contenders, scripts, devDeps, notes);
    if (!winner) continue;
    facet[role] = winner.tool;
    for (const candidate of contenders) {
      if (candidate.tool !== winner.tool || !candidate.sourceId || !candidate.capture) continue;
      files[candidate.capture.file] = candidate.capture.contents;
      facet.configs[candidate.sourceId] = candidate.capture.file;
    }
  }

  // The same gates as every other capture: size, and no machine paths.
  const captureConfig = async (sourceId: string) => {
    const capture = gatedCapture(sourceId, await read(sourceId), notes);
    if (!capture) return;
    files[capture.file] = capture.contents;
    facet.configs[sourceId] = capture.file;
  };
  if (rootFiles.has(".editorconfig")) await captureConfig(".editorconfig");
  if (inventory.dirs.includes(".github/workflows")) facet.ci = "github-actions";
  else if (rootFiles.has(".gitlab-ci.yml")) facet.ci = "gitlab-ci";

  // Hook managers fingerprint like the other roles: by their own config
  // file, and the file-based ones are captured like any other config, so
  // `new` writes the file back and check can recreate it. Husky is a
  // directory of scripts, which is not a single capturable config.
  if (inventory.dirs.includes(".husky")) facet.hooks = "husky";
  else {
    const hookFile = firstFile(["lefthook.yml", "lefthook.yaml", ".lefthook.yml", "lefthook.toml"]);
    if (hookFile) {
      facet.hooks = "lefthook";
      await captureConfig(hookFile);
    } else if (rootFiles.has(".pre-commit-config.yaml")) {
      facet.hooks = "pre-commit";
      await captureConfig(".pre-commit-config.yaml");
    }
  }

  // A release tool's root config is captured like a hook manager's, so
  // `new` writes it back and the config rule owns it, with the releases
  // rule standing down for a captured one. Only a file can be captured; a
  // `.changeset/` directory stays the author's to add.
  const releaseConfig = (await detectReleaseTool(inventory))?.fingerprints.find(
    (fingerprint) => !fingerprint.endsWith("/") && rootFiles.has(fingerprint),
  );
  if (releaseConfig) await captureConfig(releaseConfig);

  const bySecondaryEco = new Map<string, string[]>();
  for (const c of dedupe(secondary)) {
    const list = bySecondaryEco.get(c.ecosystem) ?? [];
    list.push(`${c.role}: ${c.tool}`);
    bySecondaryEco.set(c.ecosystem, list);
  }
  for (const [eco, tools] of [...bySecondaryEco].sort(([a], [b]) => (a < b ? -1 : 1))) {
    notes.push(
      `${eco} (secondary ecosystem) tooling: ${tools.join(", ")}. Promote by hand if wanted.`,
    );
  }

  const hasFacet = Object.entries(facet).some(([key, value]) =>
    key === "configs" || key === "binding"
      ? Object.keys(value as object).length > 0
      : value !== undefined,
  );
  return { toolchain: hasFacet ? facet : undefined, files, notes };
}

/** One candidate per (tool, role); first fingerprint hit fixed the sourceId. */
function dedupe(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = `${c.tool} ${c.role}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Exclusive-role conflicts resolve through a deterministic ladder: unique
 * reference in manifest scripts → unique devDependency declaration → no facet.
 */
function resolveRole(
  role: Role,
  contenders: Candidate[],
  scripts: string,
  devDeps: Record<string, string>,
  notes: string[],
): Candidate | undefined {
  if (contenders.length === 0) return undefined;
  if (contenders.length === 1) return contenders[0];

  const rungs = [
    (c: Candidate) => new RegExp(`\\b${escapeRegExp(c.tool)}\\b`).test(scripts),
    (c: Candidate) => c.tool in devDeps || packageOf(c.tool) in devDeps,
  ];
  for (const rung of rungs) {
    const survivors = contenders.filter(rung);
    if (survivors.length === 1) {
      const winner = survivors[0] as Candidate;
      const losers = contenders.filter((c) => c.tool !== winner.tool).map((c) => c.tool);
      notes.push(
        `${role}: ${winner.tool} chosen (uniquely wired into the manifest); ${losers.sort().join(", ")} also present and not captured.`,
      );
      return winner;
    }
  }
  notes.push(
    `${role} left unset: ${contenders.map((c) => `${c.tool} (${c.evidence})`).join(", ")} are all present and none is uniquely wired in.`,
  );
  return undefined;
}

function packageOf(tool: string): string {
  return tool === "biome" ? "@biomejs/biome" : tool;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Capture gates: size cap and no machine-specific paths; failures become notes. */
function gatedCapture(sourceId: string, contents: string, notes: string[]): Candidate["capture"] {
  if (contents.length > TOOLCHAIN_TUNING.maxCaptureBytes) {
    notes.push(
      `${sourceId} skipped (over ${TOOLCHAIN_TUNING.maxCaptureBytes / 1024} KiB); the tool is still recorded.`,
    );
    return undefined;
  }
  if (hasMachinePath(contents)) {
    notes.push(
      `${sourceId} skipped: it references machine-specific paths; the tool is still recorded.`,
    );
    return undefined;
  }
  const basename = sourceId.includes("#")
    ? `${sourceId.replace(/\.(json|toml)#/, ".").replace(/[^A-Za-z0-9.-]/g, ".")}${sourceId.startsWith("pyproject") ? ".toml" : ".json"}`
    : sourceId.slice(sourceId.lastIndexOf("/") + 1);
  return { file: `toolchain/${basename}`, contents };
}

/** pyproject.toml parsed, with a note when it will not parse, since its tool tables feed several roles. */
async function readTomlSafe(
  absPath: string,
  notes: string[],
): Promise<Record<string, unknown> | undefined> {
  const parsed = parseTomlSafe(await Bun.file(absPath).text());
  if (parsed === undefined) {
    notes.push(
      `${absPath.slice(absPath.lastIndexOf("/") + 1)} could not be parsed; tool sections inside it were skipped.`,
    );
  }
  return parsed;
}
