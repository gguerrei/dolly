# Exports: design

How a pattern travels into the tools that read conventions but never read
`pattern.md`: coding agents and editors. M8 turns one saved pattern into a
Claude skill, a Cursor rule, an `AGENTS.md`, or a plain system prompt, and
adds the two facets those files lean on most, `commits` and `releases`,
which are the first to read git history. The history exception is
recorded in [ADR-0005](../adr/0005-history-facets.md); this document is the
mechanics. The `.dolly` bundle (M1) stays the way a pattern travels between
dolly installs; the new targets are the way it travels everywhere else.

## Ground rules

1. **One rendering, many frames.** Every text target renders the same
   brief: the facets as prose a reader can follow without dolly, then the
   pattern's own conventions verbatim. A target adds only its frame (the
   frontmatter a skill or a rule needs, the opening line a prompt needs)
   and its default path. Two targets never disagree on what a facet means,
   because neither renders facets itself.
2. **Exports render one file.** Captured configs and templates are named in
   the brief ("the pattern carries `biome.json`") and travel in the bundle,
   never inline: an agent file that embeds a 200 KiB config is one nobody
   reads. A target that wants the files runs `dolly new` or `dolly fit`.
3. **Nothing secret can enter.** The brief is a function of the pattern
   document alone. Keys live in the keychain and the AI switch in
   `ai.json`; neither is reachable from a `PatternDocument`, so the rule
   holds by construction rather than by filter.
4. **An export lands in a project, never over one.** Each target has the
   path its consumer expects (`AGENTS.md` at the root, `.cursor/rules/`,
   `.claude/skills/`), resolved against the working directory or `--out`.
   An existing file is refused without `--force`, since an `AGENTS.md` is
   usually hand-written and the loss would be silent.
5. **History facets are the one read past the tree.** `commits` and
   `releases` read `git log` and `git tag` under ADR-0005's exception:
   bounded, vote-based, and absent (never wrong) without a repository or
   without `git`. Check stays a function of the tree: it enforces the parts
   of these facets that live in files and leaves message grammar to the
   hook manager and to the readers of the exports.

## The facets

### `commits`

Message grammar, voted from the last 200 non-merge commits reachable from
`HEAD`. Fewer than 10 and nothing is emitted.

| Field | Values | Vote |
|---|---|---|
| `style` | `conventional`, `gitmoji`, `free` | a style clears the bar at 80% of the sample; `free` when neither does |
| `types` | `feat`, `fix`, ... | conventional only: every type seen at least twice, alphabetical |
| `scope` | `required`, `optional`, `never` | conventional only: 80% carry one, none does, or in between |
| `subject` | `lower`, `sentence` | the first letter of the subject line, at 80%, any style |

Conventional is `type(scope)!: subject` with a lowercase type; gitmoji is a
leading emoji or `:shortcode:`. `free` is emitted only when `subject` was
voted, so the facet always says something a reader can act on. A style
between 50% and 80% becomes a counted note ("14 of 20 commits follow
Conventional Commits; set `commits.style` by hand if intentional"), the
same three-way degradation every scanner has.

### `releases`

| Field | Values | Evidence |
|---|---|---|
| `versioning` | `semver`, `calver` | tags: 80% of at least 3 tags parse as one shape |
| `changelog` | `keep-a-changelog`, `generated` | `CHANGELOG.md` citing Keep a Changelog or using its `[Unreleased]` and `Added`/`Changed` headings; or a tool below that writes one |
| `tool` | `changesets`, `semantic-release`, `release-please`, `git-cliff`, `standard-version`, `goreleaser`, `commitizen`, `python-semantic-release` | one root fingerprint each (`.changeset/`, `.releaserc*`, `release-please-config.json`, `cliff.toml`, `.versionrc*`, `.goreleaser.y*ml`, `.cz.toml` or `[tool.commitizen]`, `[tool.semantic_release]`) |

Only `versioning` reads history; the other two are tree evidence and
would have been legal before the ADR. A `CHANGELOG.md` in a style dolly
does not recognize is a note, not a facet.

### Check

The `releases` rule is tree-only: a pattern with `changelog:
keep-a-changelog` and no `CHANGELOG.md` gets a create fix with the
format's header; a pattern naming a `tool` whose fingerprint is missing
is reported with the file to add, never fixed (tool configs are the
author's). There is no `commits` rule: a commit is not a path, and the
tree-side enforcement of message grammar is a commitlint or commitizen
config, which the config rule already compares when the pattern captured
one.

## The targets

| Target | Default path | Frame |
|---|---|---|
| `bundle` | `<name>.dolly` | the M1 zip of the pattern directory, unchanged |
| `claude-skill` | `.claude/skills/<name>/SKILL.md` | frontmatter `name` and `description` (when to use it), then the brief |
| `cursor` | `.cursor/rules/<name>.mdc` | frontmatter `description` and `alwaysApply: true`, then the brief |
| `agents-md` | `AGENTS.md` | the brief under a heading naming the pattern |
| `prompt` | `<name>.prompt.md` | one opening line ("You are working in a project organized by ...") then the brief |

The brief, in order, skipping facets the pattern lacks: languages (with
runtime pins and the natural language of docs), layout (required marked),
naming (defaults and per-extension overrides), toolchain (roles and the
captured config files by name), dependencies by purpose with the version
policy, testing, commands as a table, license, commits, releases, then
the pattern's prose under "Conventions" with its headings demoted one
level so the author's structure survives inside the export's.

## Surfaces

- CLI: `dolly export <pattern> [--as <target>] [--out <path>] [--force]`.
  `--as` defaults to `bundle`, so the M1 verb reads exactly as before;
  `--out -` writes to stdout for piping.
- Daemon: `GET /api/export?pattern&as` returns `{ target, path, contents }`
  for the preview; `POST /api/export` with `{ dir, pattern, as, force? }`
  writes the file at its default path under `dir` (409 when it exists
  and `force` is not set). The bundle stays a CLI target until the native
  shell's file picker lands (M9), like import.
- GUI: the export view, designed on the canvas first: pick a target,
  preview the rendered file, save it into the project directory the other
  views share, or copy it. The pattern view's overview shows the two new
  facets beside license.

## Acceptance

A repository with 30 Conventional Commits, two of them scoped, tagged
`v0.1.0` through `v0.3.0`, with a Keep a Changelog file and a `.changeset/`
directory: extract yields `commits: { style: conventional, types: [...],
scope: optional, subject: lower }` and `releases: { versioning: semver,
changelog: keep-a-changelog, tool: changesets }`. The same tree as a
tarball (no `.git`) yields neither `commits` nor `releases.versioning`
and every other facet byte-identical. Exporting the pattern as each
target writes the expected path with the expected frame, the same brief
in all four, the prose intact, and a second export refuses to overwrite
without `--force`.
