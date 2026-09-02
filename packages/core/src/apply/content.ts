import { basename, dirname } from "node:path";
import type { Ecosystem } from "../extract/registry";
import type { Pattern } from "../pattern/schema";

/**
 * The file contents dolly is willing to invent: hygiene stubs for the
 * well-known files a layout can require. Shared by the scaffolder (filling
 * a fresh tree) and check's create-fixes (filling a hole in an existing
 * one), so both write the same bytes for the same path.
 */

export function stubContents(
  path: string,
  projectName: string,
  patternName: string,
  pattern: Pattern,
  ecosystem: Ecosystem | undefined,
): string {
  const name = basename(path);
  if (/^readme($|\.)/i.test(name)) return readme(projectName, patternName, pattern);
  if (name === ".gitignore") return gitignoreFor(ecosystem);
  if (/^changelog\.md$/i.test(name)) return "# Changelog\n";
  if (/^contributing\.md$/i.test(name)) return `# Contributing to ${projectName}\n`;
  if (/^security\.md$/i.test(name)) return "# Security Policy\n";
  if (/^code_of_conduct\.md$/i.test(name)) return "# Code of Conduct\n";
  if (name === "tsconfig.json") return "{}\n";
  if (name === "package.json" && path.includes("/")) {
    // An instantiated workspace member needs a valid manifest to install.
    const module = basename(dirname(path));
    return `${JSON.stringify({ name: `@${projectName}/${module}`, version: "0.1.0" }, null, 2)}\n`;
  }
  return "";
}

export function gitignoreFor(ecosystem: Ecosystem | undefined): string {
  const byEcosystem: Record<Ecosystem, string[]> = {
    npm: ["node_modules/", "dist/", "coverage/"],
    pypi: ["__pycache__/", ".venv/", "dist/", ".pytest_cache/", ".ruff_cache/"],
    cargo: ["target/"],
    go: [],
    rubygems: [".bundle/", "vendor/bundle/", "log/", "tmp/"],
    maven: ["target/", "build/", ".gradle/"],
    composer: ["vendor/"],
    nuget: ["bin/", "obj/"],
  };
  return `${[...(ecosystem ? byEcosystem[ecosystem] : []), ".env"].join("\n")}\n`;
}

function readme(projectName: string, patternName: string, pattern: Pattern): string {
  const lines = [`# ${projectName}`, "", `Scaffolded from the "${patternName}" pattern by dolly.`];
  const commands = Object.entries(pattern.commands ?? {});
  if (commands.length > 0) {
    lines.push("", "## Commands", "");
    for (const [verb, command] of commands) lines.push(`- \`${verb}\`: \`${command}\``);
  }
  return `${lines.join("\n")}\n`;
}
