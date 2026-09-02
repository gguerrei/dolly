import { beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json";

// fileURLToPath, not pathname: a URL pathname on Windows is "/D:/...", which nothing can open.
const CLI = fileURLToPath(new URL("../src/main.ts", import.meta.url));

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "dolly-cli-"));
});

async function dolly(...args: string[]) {
  return dollyWithEnv({}, ...args);
}

async function dollyWithEnv(env: Record<string, string>, ...args: string[]) {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    cwd: home,
    env: { ...process.env, DOLLY_HOME: home, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

/** A fake $EDITOR: a bun script that overwrites the file it is given. */
async function fakeEditor(newContent: string): Promise<string> {
  const script = join(home, `editor-${Math.random().toString(36).slice(2)}.js`);
  await writeFile(script, `await Bun.write(process.argv[2], ${JSON.stringify(newContent)});\n`);
  return `bun ${script}`;
}

async function seedPattern(name: string, patternMd: string) {
  const dir = join(home, "patterns", name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "pattern.md"), patternMd);
}

describe("dolly CLI", () => {
  test("--version matches the package version", async () => {
    const { stdout, exitCode } = await dolly("--version");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(pkg.version);
  });

  test("list explains itself when the store is empty", async () => {
    const { stdout, exitCode } = await dolly("list");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("No patterns saved yet");
  });

  test("list, show, and delete walk a seeded pattern", async () => {
    await seedPattern("tidy", "---\nname: tidy\ndescription: Keep it tidy.\n---\n");

    const list = await dolly("list");
    expect(list.stdout).toContain("tidy");
    expect(list.stdout).toContain("Keep it tidy.");

    const show = await dolly("show", "tidy");
    expect(show.exitCode).toBe(0);
    expect(show.stdout).toContain("name: tidy");

    const del = await dolly("delete", "tidy");
    expect(del.exitCode).toBe(0);
    expect((await dolly("list")).stdout).toContain("No patterns saved yet");
  });

  test("list flags a hand-broken pattern instead of hiding it", async () => {
    await seedPattern("broken", "---\nname: broken\nlayotu: []\n---\n");
    const { stdout, exitCode } = await dolly("list");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("broken");
    expect(stdout).toContain("invalid pattern.md");
  });

  test("show of a missing pattern fails with a friendly error", async () => {
    const { stderr, exitCode } = await dolly("show", "nope");
    expect(exitCode).toBe(1);
    expect(stderr).toContain('No saved pattern named "nope"');
  });

  test("home prints the data root, honoring DOLLY_HOME", async () => {
    const { stdout, exitCode } = await dolly("home");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(home);
  });

  test("edit validates the file the editor saved", async () => {
    await seedPattern("tidy", "---\nname: tidy\n---\n");
    const editor = await fakeEditor("---\nname: tidy\ndescription: Edited.\n---\n");

    const { stdout, exitCode } = await dollyWithEnv({ EDITOR: editor }, "edit", "tidy");
    expect(exitCode).toBe(0);
    expect(stdout).toContain('"tidy" saved and valid');
    expect((await dolly("show", "tidy")).stdout).toContain("Edited.");
  });

  test("edit reports validation errors and fails when not interactive", async () => {
    await seedPattern("tidy", "---\nname: tidy\n---\n");
    const editor = await fakeEditor("---\nname: Not Valid\n---\n");

    const { stderr, exitCode } = await dollyWithEnv({ EDITOR: editor }, "edit", "tidy");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid pattern facets");
    // The store never holds the broken draft: the editor worked on a copy.
    expect(stderr).toContain("Nothing written. Your edit is kept at");
    expect(await readFile(join(home, "patterns", "tidy", "pattern.md"), "utf8")).toBe(
      "---\nname: tidy\n---\n",
    );
  });

  test("edit explains itself when no editor is configured", async () => {
    await seedPattern("tidy", "---\nname: tidy\n---\n");
    const { stderr, exitCode } = await dollyWithEnv({ EDITOR: "", VISUAL: "" }, "edit", "tidy");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("$EDITOR");
  });

  test("an empty $VISUAL does not shadow a working $EDITOR", async () => {
    await seedPattern("tidy", "---\nname: tidy\n---\n");
    const editor = await fakeEditor("---\nname: tidy\ndescription: Via EDITOR.\n---\n");
    const { exitCode } = await dollyWithEnv({ VISUAL: "", EDITOR: editor }, "edit", "tidy");
    expect(exitCode).toBe(0);
  });

  test("extract learns a pattern from a project directory", async () => {
    const project = join(home, "my-widget");
    await mkdir(join(project, "src"), { recursive: true });
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({ name: "widget", dependencies: { zod: "^4.0.0" } }),
    );
    await writeFile(join(project, "src", "index.ts"), "export {};\n");
    await writeFile(join(project, "README.md"), "# widget\n");

    const extracted = await dolly("extract", project);
    expect(extracted.exitCode).toBe(0);
    expect(extracted.stdout).toContain('Saved pattern "my-widget"');

    const again = await dolly("extract", project);
    expect(again.exitCode).toBe(1);
    expect(again.stderr).toContain("--force");
    expect((await dolly("extract", project, "--force")).exitCode).toBe(0);

    const shown = await dolly("show", "my-widget");
    expect(shown.stdout).toContain("validation: zod");
  });

  test("extract from several projects needs a name, and keeps what they agree on", async () => {
    const make = async (name: string, license: string) => {
      const dir = join(home, name);
      await mkdir(join(dir, "src"), { recursive: true });
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({ name, license, scripts: { test: "bun test" } }),
      );
      await writeFile(join(dir, "src", "index.ts"), "export {};\n");
      return dir;
    };
    const one = await make("one", "MIT");
    const two = await make("two", "Apache-2.0");
    const unnamed = await dolly("extract", one, two);
    expect(unnamed.exitCode).toBe(1);
    expect(unnamed.stderr).toContain("Name the pattern with --name");
    const named = await dolly("extract", one, two, "--name", "pair");
    expect(named.exitCode).toBe(0);
    expect(named.stdout).toContain('Saved pattern "pair" from 2 projects');
    const shown = await dolly("show", "pair");
    expect(shown.stdout).toContain("test: bun test");
    expect(shown.stdout).not.toContain("license:");
    expect(shown.stdout).toContain("license disagrees");
  });

  test("new scaffolds a project from a saved pattern", async () => {
    await seedPattern(
      "tidy",
      [
        "---",
        "name: tidy",
        "license: MIT",
        "layout:",
        "  - path: src/",
        "    required: true",
        "  - path: package.json",
        "    required: true",
        "---",
      ].join("\n"),
    );

    const { stdout, exitCode } = await dolly("new", "tidy", "fresh-app");
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Scaffolded "tidy" into fresh-app/');
    expect(stdout).toContain("Next steps:");

    const manifest = await Bun.file(join(home, "fresh-app", "package.json")).json();
    expect(manifest.name).toBe("fresh-app");
    expect(manifest.license).toBe("MIT");
    expect(await Bun.file(join(home, "fresh-app", "LICENSE")).text()).toContain("MIT License");

    const again = await dolly("new", "tidy", "fresh-app");
    expect(again.exitCode).toBe(1);
    expect(again.stderr).toContain("not empty");
  });

  test("check resolves the marker, exits 1 on violations, and 0 after --fix", async () => {
    await seedPattern(
      "tidy",
      ["---", "name: tidy", "layout:", "  - path: docs/", "    required: true", "---"].join("\n"),
    );
    const project = join(home, "checked");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, ".dolly"), "pattern: tidy\n");

    const dirty = await dolly("check", "-C", project);
    expect(dirty.exitCode).toBe(1);
    expect(dirty.stdout).toContain("docs/");
    expect(dirty.stdout).toContain("[fixable]");

    const fixed = await dolly("check", "-C", project, "--fix");
    expect(fixed.exitCode).toBe(0);
    expect(fixed.stdout).toContain("Clean");

    // An explicit pattern argument beats the marker.
    const named = await dolly("check", "tidy", "-C", project);
    expect(named.exitCode).toBe(0);
  });

  test("link writes the marker, keeps its ignore list, and names what it replaced", async () => {
    await seedPattern("tidy", ["---", "name: tidy", "---"].join("\n"));
    await seedPattern("neat", ["---", "name: neat", "---"].join("\n"));
    const project = join(home, "linked");
    await mkdir(project, { recursive: true });
    const first = await dolly("link", "tidy", "-C", project);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain(`Linked ${project} to "tidy"`);
    expect(await readFile(join(project, ".dolly"), "utf8")).toBe("pattern: tidy\n");

    await writeFile(join(project, ".dolly"), "pattern: tidy\nignore:\n  - legacy/\n");
    const second = await dolly("link", "neat", "-C", project);
    expect(second.stdout).toContain('it was linked to "tidy"');
    expect(await readFile(join(project, ".dolly"), "utf8")).toBe(
      "pattern: neat\nignore:\n  - legacy/\n",
    );

    const missing = await dolly("link", "nope", "-C", project);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain('No saved pattern named "nope"');
  });

  test("check --json prints the daemon's wire shape, the ignored count included", async () => {
    await seedPattern(
      "tidy",
      ["---", "name: tidy", "layout:", "  - path: docs/", "    required: true", "---"].join("\n"),
    );
    const project = join(home, "json");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, ".dolly"), "pattern: tidy\nignore:\n  - docs/\n");
    const { stdout, exitCode } = await dolly("check", "-C", project, "--json");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      pattern: "tidy",
      violations: [],
      fixed: [],
      diagnostics: [],
      ignored: 1,
    });
    const plain = await dolly("check", "-C", project);
    expect(plain.stdout).toContain("(1 violation ignored by .dolly)");
  });

  test("fit previews as a dry run, then applies behind a checkpoint branch", async () => {
    await seedPattern(
      "kebab",
      ["---", "name: kebab", "naming:", "  files: kebab-case", "---"].join("\n"),
    );
    const project = join(home, "fitted");
    await mkdir(join(project, "src"), { recursive: true });
    await writeFile(join(project, ".dolly"), "pattern: kebab\n");
    await writeFile(join(project, "src", "MyHelper.ts"), "export const helper = 1;\n");
    await writeFile(join(project, "src", "app.ts"), 'export { helper } from "./MyHelper";\n');

    // Dry run: the plan prints, nothing changes, and --apply's precondition is named.
    const dry = await dolly("fit", "-C", project);
    expect(dry.exitCode).toBe(0);
    expect(dry.stdout).toContain("move    src/MyHelper.ts → src/my-helper.ts");
    expect(dry.stdout).toContain('src/app.ts: "./MyHelper" → "./my-helper"');
    expect(dry.stdout).toContain("needs a git repository");
    expect(await Bun.file(join(project, "src", "MyHelper.ts")).exists()).toBe(true);

    const git = async (...args: string[]) =>
      Bun.spawn(["git", ...args], { cwd: project, stdout: "ignore", stderr: "ignore" }).exited;
    await git("init", "-q");
    await git("config", "user.email", "fit@test");
    await git("config", "user.name", "fit test");
    await git("add", "-A");
    await git("commit", "-q", "-m", "before");

    const applied = await dolly("fit", "-C", project, "--apply");
    expect(applied.exitCode).toBe(0);
    expect(applied.stdout).toContain("Checkpoint: branch dolly/fit-kebab-1");
    expect(await Bun.file(join(project, "src", "my-helper.ts")).exists()).toBe(true);
    expect(await Bun.file(join(project, "src", "app.ts")).text()).toContain('"./my-helper"');

    const settled = await dolly("fit", "-C", project);
    expect(settled.stdout).toContain("Nothing to fit");
  });

  test("fit prints each fix's patch under its line", async () => {
    await seedPattern(
      "scripted",
      [
        "---",
        "name: scripted",
        "languages:",
        "  programming:",
        "    - TypeScript",
        "commands:",
        "  test: bun test",
        "---",
      ].join("\n"),
    );
    const project = join(home, "scripted");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, ".dolly"), "pattern: scripted\n");
    await writeFile(join(project, "package.json"), '{\n  "name": "x",\n  "scripts": {}\n}\n');
    const { stdout } = await dolly("fit", "-C", project);
    expect(stdout).toContain("merge   package.json");
    expect(stdout).toContain('        +     "test": "bun test"');
  });

  test("completions render for zsh, bash, and fish, and refuse another shell", async () => {
    const verbs = [
      "extract",
      "new",
      "check",
      "fit",
      "learn",
      "list",
      "show",
      "edit",
      "delete",
      "export",
      "import",
      "link",
      "serve",
      "ai",
      "home",
      "completions",
    ];
    for (const [shell, marker] of [
      ["zsh", "#compdef dolly"],
      ["bash", "complete -F _dolly dolly"],
      ["fish", "complete -c dolly -f"],
    ] as const) {
      const { stdout, exitCode } = await dolly("completions", shell);
      expect(exitCode).toBe(0);
      expect(stdout).toContain(marker);
      for (const verb of verbs) expect(stdout).toContain(verb);
      expect(stdout).toContain("connect"); // the ai subcommands
      expect(stdout).toContain("dolly list 2>/dev/null"); // live pattern names
    }
    const other = await dolly("completions", "powershell");
    expect(other.exitCode).toBe(1);
    expect(other.stderr).toContain("one of: zsh, bash, fish");
  });

  test("learn --once proposes what the project grew, and writes only with --yes", async () => {
    await seedPattern(
      "tidy",
      ["---", "name: tidy", "commands:", "  test: bun test", "---", "", "Keep it tidy."].join("\n"),
    );
    const project = join(home, "learned");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, ".dolly"), "pattern: tidy\n");
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({ name: "learned", scripts: { test: "bun test", lint: "biome lint ." } }),
    );

    // Not a terminal and no --yes: the proposals print, nothing is written.
    const shown = await dolly("learn", "-C", project, "--once");
    expect(shown.exitCode).toBe(0);
    expect(shown.stdout).toContain("commands.lint");
    expect(shown.stdout).toContain("+   lint: biome lint .");
    expect(shown.stdout).toContain("Nothing written");
    expect(await readFile(join(home, "patterns", "tidy", "pattern.md"), "utf8")).not.toContain(
      "lint",
    );

    const learned = await dolly("learn", "-C", project, "--once", "--yes");
    expect(learned.exitCode).toBe(0);
    // The hand-seeded pattern is thinner than extract's reading of the project: four proposals.
    expect(learned.stdout).toContain('Learned 4 changes into "tidy"');
    const after = await readFile(join(home, "patterns", "tidy", "pattern.md"), "utf8");
    expect(after).toContain("lint: biome lint .");
    expect(after).toContain("Keep it tidy.");

    const settled = await dolly("learn", "tidy", "-C", project, "--once");
    expect(settled.stdout).toContain("Nothing to learn");
  });

  test("serve refuses a port that is not one", async () => {
    for (const port of ["abc", "70000"]) {
      const result = await dolly("serve", "--port", port);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("is not a port (0 to 65535)");
    }
  });

  test("check without a pattern or marker explains itself", async () => {
    const project = join(home, "unmarked");
    await mkdir(project, { recursive: true });
    const { stderr, exitCode } = await dolly("check", "-C", project);
    expect(exitCode).toBe(1);
    expect(stderr).toContain(".dolly marker");
  });

  test("check refuses --fix combined with --watch", async () => {
    await seedPattern("tidy", "---\nname: tidy\n---\n");
    const { stderr, exitCode } = await dolly("check", "tidy", "--fix", "--watch");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("feedback loop");
  });

  test("export and import round-trip through a .dolly file", async () => {
    await seedPattern("tidy", "---\nname: tidy\ndescription: Keep it tidy.\n---\n");

    const exported = await dolly("export", "tidy");
    expect(exported.exitCode).toBe(0);
    expect(exported.stdout).toContain("tidy.dolly");

    await dolly("delete", "tidy");
    const imported = await dolly("import", join(home, "tidy.dolly"));
    expect(imported.exitCode).toBe(0);
    expect(imported.stdout).toContain('Imported "tidy": Keep it tidy.');

    const again = await dolly("import", join(home, "tidy.dolly"));
    expect(again.exitCode).toBe(1);
    expect(again.stderr).toContain("--force");
    expect((await dolly("import", "--force", join(home, "tidy.dolly"))).exitCode).toBe(0);
  });

  test("export --as renders a target at its path, prints with --out -, and overwrites only with --force", async () => {
    await seedPattern(
      "tidy",
      "---\nname: tidy\ndescription: Keep it tidy.\ncommands:\n  test: bun test\n---\n\nBe tidy.\n",
    );

    const agents = await dolly("export", "tidy", "--as", "agents-md");
    expect(agents.exitCode).toBe(0);
    // Compared through realpath: tmp is a symlink on macOS and a short 8.3 name on Windows.
    const exportedTo = agents.stdout.match(/ to (.+)$/m)?.[1] ?? "";
    expect(await realpath(exportedTo)).toBe(await realpath(join(home, "AGENTS.md")));
    const written = await readFile(join(home, "AGENTS.md"), "utf8");
    expect(written).toContain("| test | `bun test` |");
    expect(written).toContain("Be tidy.");

    const again = await dolly("export", "tidy", "--as", "agents-md");
    expect(again.exitCode).toBe(1);
    expect(again.stderr).toContain("--force");
    expect((await dolly("export", "tidy", "--as", "agents-md", "--force")).exitCode).toBe(0);

    const printed = await dolly("export", "tidy", "--as", "prompt", "--out", "-");
    expect(printed.exitCode).toBe(0);
    expect(printed.stdout).toStartWith(
      'You are working in a project organized by the "tidy" pattern',
    );

    const skill = await dolly("export", "tidy", "--as", "claude-skill");
    expect(skill.exitCode).toBe(0);
    expect(await readFile(join(home, ".claude/skills/tidy/SKILL.md"), "utf8")).toStartWith(
      "---\nname: tidy\n",
    );

    const unknown = await dolly("export", "tidy", "--as", "vim");
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain("bundle, claude-skill, cursor, agents-md, prompt");
  });

  test("ai: off by default, on with an env key, off again on request", async () => {
    const off = await dolly("ai");
    expect(off.exitCode).toBe(0);
    expect(off.stdout).toContain("AI is off");

    const use = await dollyWithEnv({ ANTHROPIC_API_KEY: "sk-cli" }, "ai", "use", "anthropic");
    expect(use.exitCode).toBe(0);
    expect(use.stdout).toContain(
      "AI is on: anthropic, model claude-sonnet-5 (key from the environment).",
    );

    const pinned = await dollyWithEnv(
      { ANTHROPIC_API_KEY: "sk-cli" },
      "ai",
      "use",
      "anthropic",
      "--model",
      "claude-pinned",
    );
    expect(pinned.stdout).toContain("model claude-pinned");

    expect((await dolly("ai", "off")).exitCode).toBe(0);
    expect((await dolly("ai")).stdout).toContain("AI is off");
  });

  test("ai use without a key refuses, naming both ways in", async () => {
    const res = await dollyWithEnv(
      { OPENAI_API_KEY: "", PATH: await noKeychainPath() },
      "ai",
      "use",
      "openai",
    );
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("No key for OpenAI");
    expect(res.stderr).toContain("OPENAI_API_KEY");
  });

  test("ai connect refuses an unknown provider before asking for a key", async () => {
    const res = await dolly("ai", "connect", "mistral");
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('Unknown provider "mistral"');
  });
});

/**
 * A PATH whose secret-tool always fails, so the test cannot be rescued by a
 * real keychain on the machine running it. The rest of PATH stays, since the
 * child still needs to be bun.
 */
async function noKeychainPath(): Promise<string> {
  const dir = join(home, "no-keychain");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "secret-tool"), "#!/usr/bin/env bash\nexit 1\n");
  await chmod(join(dir, "secret-tool"), 0o755);
  return `${dir}:${process.env.PATH ?? ""}`;
}
