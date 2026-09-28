# Using dolly

A pattern is a directory containing `pattern.md`, captured configs, and file templates. The Markdown file stores structured conventions in YAML frontmatter and your written conventions in its body. Open it with `dolly edit my-style`; dolly validates the file when you save.

## Extract a pattern

```sh
dolly extract . --name my-style
dolly show my-style
```

Extraction reads the repository without requiring annotations or a model. It records layout, naming, toolchains, dependencies by purpose, tests, commands, languages, licenses, commits, and releases where the evidence supports them. Read the extraction notes before applying the result elsewhere. They explain gaps, mixed conventions, and anything that needs your judgment.

Toolchains and dependencies are recognized for npm, PyPI, Cargo, Go, RubyGems, Maven, Gradle, Composer, and NuGet. Workspace manifests are read through their members.

To capture what several repositories agree on:

```sh
dolly extract ../service-a ../service-b --name team-style
```

The result keeps shared conventions and records disagreements in the notes. Set `DOLLY_HOME` to a scratch directory when experimenting to keep the extracted patterns separate from your usual library.

## Agent instructions

```sh
dolly export my-style --as agents-md
```

Each text export contains the pattern's structured conventions as prose, followed by its written conventions. Existing files are preserved unless you explicitly pass `--force`. Use `--out` to inspect an export at another path first.

| Target | Output path |
| --- | --- |
| `agents-md` | `AGENTS.md` |
| `claude-md` | `CLAUDE.md` |
| `claude-skill` | `.claude/skills/<pattern>/SKILL.md` |
| `cursor` | `.cursor/rules/<pattern>.mdc` |
| `copilot` | `.github/copilot-instructions.md` |
| `gemini` | `GEMINI.md` |
| `windsurf` | `.windsurf/rules/<pattern>.md` |
| `cline` | `.clinerules/<pattern>.md` |
| `prompt` | `<pattern>.prompt.md` |

Edit the pattern and export it again when the conventions change. These files give an agent instructions; `dolly check` separately verifies the structured rules that dolly supports.

## Start a project

```sh
dolly new my-style ../next-project
dolly check -C ../next-project
```

Scaffolding creates the layout, captured configs at their original paths, file templates with the project's name substituted, a base manifest with commands and runtime pins, and a license. It initializes Git and writes a `.dolly` marker pointing to the pattern. Follow the next steps printed by the command to finish setting up your project.

## Checks and exceptions

```sh
dolly check my-style
dolly check my-style --watch
dolly check my-style --json
```

Without a pattern argument, `check` uses the project's `.dolly` marker. Ten rules cover layout, naming, configs, test placement, commands, languages, licenses, hooks, releases, and environment file hygiene. Captured configs bind as subsets by default, so projects can extend them.

`--fix` creates missing files, appends entries, and merges the pattern's values into supported configs. A merge can update an existing value, such as a test command, while preserving unrelated settings. File deletions and whole file replacements belong to fit. `--watch` and `--fix` are separate modes. Errors produce exit status 1; warnings and ignored violations do not.

Use `dolly ignore` to record known violations by path and `dolly rules` to disable a rule or lower it to a warning. Both edit the marker. The report counts ignored violations, and fixes leave them alone. Run either command with `--help` for its arguments.

## Fit an existing project

```sh
dolly fit my-style -C ../existing-project
```

Fit previews changes to bring a project toward a pattern, including moves, renames, and replacements beyond the scope of `check --fix`. The preview includes patches and relative import rewrites. Moves that dolly cannot account for are declined with a reason.

`--apply` requires a clean Git tree, creates a checkpoint branch, and commits the result. Switching to that branch restores the previous state. Read the plan before applying it.

## Share a pattern

```sh
dolly export my-style
dolly import my-style.dolly
```

The default export is a `.dolly` bundle containing the pattern and its captured files. Import accepts a path or an HTTPS URL. Use `--sha256` to verify a shared bundle against a known hash.

To make a repository carry its own pattern:

```sh
dolly link my-style --vendor
```

Commit the generated `.dolly` marker and `dolly/` directory. Other checkouts, including CI, can then run `dolly check` without importing a pattern first. A marker can also name a bundle URL in `source:` with a `sha256:` pin.

## Optional AI

```sh
dolly ai connect anthropic
dolly ai --verify
```

Anthropic, OpenAI, and Google are supported with your own key. Credentials use the OS keychain on macOS and Linux, DPAPI on Windows, or an environment variable. The connect command prompts for the key.

With AI enabled, `dolly check --conventions` asks a model to review written conventions against files changed since HEAD. Its findings are reported separately from the deterministic checks and do not affect the exit status. Source content used by these features goes to the selected provider; extraction and standard checks do not need that connection.

Fit can suggest placements it cannot infer on its own. Under `--apply`, it can also translate files into a language allowed by the pattern. The dry run shows the pattern's validation commands first; the translated files must pass those checks before the original source is removed or committed.

`dolly learn` watches a project and proposes pattern edits for review as individual diffs. Changes to structured conventions need no model. With AI enabled, learn can also draft written conventions from changed source files.

## The local interface

`dolly serve --open` opens the GUI for extraction, pattern editing, scaffolding, checks, fit plans, learning, imports, and exports. The command contains the webview; the desktop app uses the same daemon and adds native file pickers. The daemon listens on `127.0.0.1` and requires the token in its startup URL.

## Other commands

`dolly list`, `show`, `delete`, and `home` manage the local library. `dolly home --prune` removes cached bundles fetched for marker source URLs when they are older than a week.

`dolly completions` supports zsh, bash, and fish, including completion of saved pattern names. Use `dolly --help` or `dolly <command> --help` for the full CLI reference.
