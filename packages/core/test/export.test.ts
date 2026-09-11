import { afterAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderBrief } from "../src/export/brief";
import { ExportExistsError, exportPattern, renderExport } from "../src/export/export";
import { parsePatternDocument } from "../src/pattern/document";
import { cleanupTempRoots, freshStore, tempDir } from "./support";

afterAll(cleanupTempRoots);

/** One pattern with every facet, so the brief is pinned line by line. */
const FULL = parsePatternDocument(`---
name: tidy-service
description: A tidy HTTP service.
license: MIT
languages:
  programming: [TypeScript, Bash]
  versions: { node: ">=22" }
  natural: en
naming:
  files: kebab-case
  directories: kebab-case
  extensions: { ".tsx": PascalCase }
layout:
  - { path: src/, required: true, description: the code }
  - { path: "src/{name}/routes.ts" }
toolchain:
  packageManager: bun
  formatter: biome
  hooks: lefthook
  configs: { biome.json: toolchain/biome.json }
testing: { placement: colocated, filePattern: "{stem}.test.ts" }
commands: { test: bun test, lint: biome check . }
dependencies:
  runtime: { http-client: undici }
  dev: { test: bun }
  versionPolicy: caret
commits: { style: conventional, types: [feat, fix], scope: optional, subject: lower }
releases: { versioning: semver, changelog: keep-a-changelog, tool: changesets }
---

Raise domain errors; translate to HTTP at the router layer.

## Extraction notes

### Layout

- 4 of 6 directories under src/ contain routes.ts.

\`\`\`sh
# not a heading
\`\`\`
`);

describe("the brief", () => {
  test("renders every facet as prose and nests the author's headings under its own", () => {
    expect(renderBrief(FULL)).toBe(`## Languages

- Write code in TypeScript; Bash is also sanctioned. Do not introduce another language.
- Runtime versions: node >=22.
- Docs and comments are written in English.

## Layout

- \`src/\` (required): the code
- \`src/{name}/routes.ts\`

\`{name}\` stands for exactly one path segment of your choosing.

## Naming

- Files are named in kebab-case.
- Directories are named in kebab-case.
- \`.tsx\` files are named in PascalCase.

## Toolchain

- Package manager: bun.
- Formatter: biome.
- Git hooks: lefthook.
- The pattern carries these configs, which \`dolly new\` and \`dolly fit\` place: \`biome.json\`.

## Dependencies

- For http-client: undici.
- For development test: bun.
- Dependency versions are written as compatible ranges.

## Testing

- Tests sit beside the code they test, named \`{stem}.test.ts\` where \`{stem}\` is the source file's basename.

## Commands

| Verb | Command |
|---|---|
| test | \`bun test\` |
| lint | \`biome check .\` |

## License

- Projects are licensed under MIT.

## Commits

- Commit messages follow Conventional Commits: \`type(scope): subject\`.
- Types in use: feat, fix.
- Scopes are optional.
- Subjects start in lower case.

## Releases

- Versions follow semantic versioning.
- \`CHANGELOG.md\` is kept by hand in Keep a Changelog form; add an entry under Unreleased with every change.
- Releases run through changesets.

## Conventions

Raise domain errors; translate to HTTP at the router layer.

### Extraction notes

#### Layout

- 4 of 6 directories under src/ contain routes.ts.

\`\`\`sh
# not a heading
\`\`\``);
  });

  test("an empty pattern is an empty brief, never a lie", () => {
    const bare = parsePatternDocument("---\nname: bare\n---\n");
    expect(renderBrief(bare)).toBe("");
    expect(renderExport(bare, "agents-md").contents).toEndWith("rather than editing here.\n");
  });
});

describe("the targets", () => {
  const brief = renderBrief(FULL);

  test("each frames the same brief at the path its consumer expects", () => {
    const skill = renderExport(FULL, "claude-skill");
    expect(skill.path).toBe(".claude/skills/tidy-service/SKILL.md");
    expect(skill.contents).toStartWith(
      "---\nname: tidy-service\ndescription: A tidy HTTP service. Use when creating or changing files in a project that follows the tidy-service pattern.\n---\n\n# tidy-service\n\nA tidy HTTP service.\n\n",
    );

    const cursor = renderExport(FULL, "cursor");
    expect(cursor.path).toBe(".cursor/rules/tidy-service.mdc");
    expect(cursor.contents).toStartWith(
      "---\ndescription: A tidy HTTP service.\nalwaysApply: true\n---\n\n# tidy-service\n\n",
    );

    const agents = renderExport(FULL, "agents-md");
    expect(agents.path).toBe("AGENTS.md");
    expect(agents.contents).toContain(
      "Exported by dolly from the `tidy-service` pattern; edit the pattern (`dolly edit tidy-service`)",
    );

    const prompt = renderExport(FULL, "prompt");
    expect(prompt.path).toBe("tidy-service.prompt.md");
    expect(prompt.contents).toStartWith(
      'You are working in a project organized by the "tidy-service" pattern: A tidy HTTP service. Follow these conventions exactly.\n\n',
    );

    // The plain files other agents read at a fixed path wear the AGENTS.md frame.
    const plain = {
      "claude-md": "CLAUDE.md",
      copilot: ".github/copilot-instructions.md",
      gemini: "GEMINI.md",
      cline: ".clinerules/tidy-service.md",
    } as const;
    const fixed = Object.entries(plain).map(([target, path]) => {
      const rendered = renderExport(FULL, target as keyof typeof plain);
      expect(rendered.path).toBe(path);
      expect(rendered.contents).toBe(agents.contents);
      return rendered;
    });
    const windsurf = renderExport(FULL, "windsurf");
    expect(windsurf.path).toBe(".windsurf/rules/tidy-service.md");
    expect(windsurf.contents).toStartWith(
      "---\ntrigger: always_on\ndescription: A tidy HTTP service.\n---\n\n# tidy-service\n\n",
    );

    for (const rendered of [skill, cursor, agents, prompt, windsurf, ...fixed]) {
      expect(rendered.contents).toEndWith(`\n\n${brief}\n`);
    }
  });

  test("a pattern without a description gets one, and a colon survives the frontmatter", () => {
    const doc = parsePatternDocument("---\nname: terse\ndescription: 'Note: terse.'\n---\n");
    expect(renderExport(doc, "cursor").contents).toStartWith(
      '---\ndescription: "Note: terse."\nalwaysApply: true\n---\n',
    );
    const bare = parsePatternDocument("---\nname: bare\n---\n");
    expect(renderExport(bare, "prompt").contents).toStartWith(
      'You are working in a project organized by the "bare" pattern: How bare projects are organized.',
    );
  });

  test("exportPattern writes at the default path, refuses to overwrite, and --force replaces", async () => {
    const store = await freshStore();
    await store.save(FULL);
    const cwd = await tempDir("dolly-export-");
    const out = join(cwd, "AGENTS.md");
    expect(await exportPattern(store, "tidy-service", "agents-md", { out })).toBe(out);
    expect(await readFile(out, "utf8")).toBe(renderExport(FULL, "agents-md").contents);

    expect(exportPattern(store, "tidy-service", "agents-md", { out })).rejects.toThrow(
      ExportExistsError,
    );
    expect(await exportPattern(store, "tidy-service", "agents-md", { out, force: true })).toBe(out);

    // The bundle target is the M1 zip under the same refusal.
    const bundle = join(cwd, "tidy.dolly");
    expect(await exportPattern(store, "tidy-service", "bundle", { out: bundle })).toBe(bundle);
    expect(exportPattern(store, "tidy-service", "bundle", { out: bundle })).rejects.toThrow(
      "already exists",
    );

    // Nested default paths are created on the way.
    const nested = join(cwd, ".claude/skills/tidy-service/SKILL.md");
    expect(await exportPattern(store, "tidy-service", "claude-skill", { out: nested })).toBe(
      nested,
    );
  });
});
