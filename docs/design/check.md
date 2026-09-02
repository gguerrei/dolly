# Check: design

How `dolly check [pattern] [--fix] [--watch]` verifies that a project still
follows its pattern. Designed at M4; three maintainer decisions (2026-08-10)
shape it: the project→pattern link is a marker file, captured configs bind as
subsets by default, and watch is a plain debounced re-run.

## Ground rules

1. **Check is a read; --fix is the only write.** A plain `dolly check` never
   touches the tree. `--fix` applies exactly the autofixes it printed, and
   fixing is idempotent: running `--fix` twice changes nothing the second
   time; that is the milestone's acceptance test.
2. **Same eyes as extract.** Check walks the tree with the shared inventory
   (ADR-0003: one deny list, gitignore semantics, generated-code filter), so
   extract, new, and check can never disagree about what a project contains.
3. **The inventory decides visibility; only the disk decides absence.** A
   gitignored or `@generated` file is invisible to every rule, but it still
   *exists*, and a create-fix aimed at it would truncate real content. So every
   create-fix re-checks the disk before writing, and a file that is present
   but invisible gets its own report-only violation instead of a "missing"
   one. (This rule exists because the first M4 build got it wrong.)
4. **Extra files are never violations.** A pattern says what must be there
   and how it must look, not what may exist. Layout checks presence; nothing
   checks absence. dolly is a shepherd, not a customs officer.
5. **No fix that could lose work.** Autofixes create, append, or merge;
   they never delete, move, or rewrite content a human wrote (renames and
   migrations are M6 `fit`'s job, behind a dry-run). "Rewrite" includes
   reflowing: a merge is offered only when reserializing the parsed file
   reproduces it byte-for-byte, so a one-key fix can never come back as a
   whole-file diff. Anything riskier degrades to a report-only violation.
6. **Pattern defects are diagnostics, never silence.** A capture file
   missing from the pattern, an unsafe source id: these are the pattern
   author's bugs, and check may be the only command a bundle-importing
   teammate ever runs. They surface in `CheckReport.diagnostics`, apart from
   the project's violations, so a broken pattern cannot report as a clean
   tree.

## The pattern link

`dolly new` writes a `.dolly` marker at the project root (one YAML line,
`pattern: <name>`), and it is meant to be committed, so the whole team checks
against the same pattern. `dolly check` resolves the pattern in this order:
an explicit argument beats the marker, the marker beats nothing, and with
neither the command errors with a hint to pass a name. A marker naming a
pattern this machine does not have degrades to the same hint (patterns are
local; a teammate imports the bundle first).

## Config binding

Captured toolchain configs bind in one of three modes, per source id:

- **subset** (default): every captured key must be present in the project's
  config with a deeply equal value; project-added keys are fine. This is the
  mode that lets a team extend `tsconfig.json` without dolly bleating.
  `--fix` deep-merges the captured keys in, captured values winning only for
  keys that are wrong or missing; project extras survive untouched.
- **verbatim**: byte equality, for the configs a maintainer wants owned
  outright. `--fix` writes the captured bytes back.
- **presence**: the file must exist; its contents are the project's own.
  The silencer for a team that legitimately diverges from a capture.

The pattern picks modes with `toolchain.binding`
(`{ "biome.json": "verbatim" }`); absent entries mean subset. Subset needs
structure, so it applies to JSON and TOML captures, the formats tool configs
actually use. Any other capture falls back to byte equality for *detection*,
and check says so in the violation rather than pretending it diffed keys,
but only explicit verbatim gets the overwrite fix. A drifted `.editorconfig`
under default binding is report-only: rewriting a hand-edited file is exactly
what ground rule 4 forbids, so the violation points at the binding dial
instead. A *missing* file keeps its create-fix in every mode, since creation
cannot lose work.

## Rules

Each rule maps one facet to violations, each violation carrying a project
path, a message, and at most one autofix:

| Rule | Reads | Violation | Autofix |
|---|---|---|---|
| `layout` | layout entries with `required: true`, minus the files the toolchain captured (those are the config rule's) | path absent (`{name}` matches any one segment) | create the directory, or the file via new's stub |
| `naming` | naming facet | file/dir name off-convention (extension overrides win) | none: renames break imports; `fit` (M6) owns them |
| `config` | toolchain.configs + binding | captured key missing/unequal (subset) or bytes differ (verbatim) | merge the keys / write the bytes |
| `commands` | commands facet | verb missing or command unequal in manifest scripts / taskfile | scripts: merge the entry; taskfile: append a missing recipe (a differing recipe is report-only; it may have grown a body dolly must not rewrite) |
| `license` | license facet | manifest field missing/unequal (npm and TOML manifests alike); LICENSE file absent | set the field; stamp the file (the stamped year comes from the clock, the one deliberate impurity). A LICENSE whose text fingerprints as a *different* id is report-only, since silently replacing license text is not a merge. A missing manifest is never invented, by this rule or config's |
| `testing` | testing facet | a test file breaking placement or `filePattern` | none: moving tests is `fit`'s job |
| `hooks` | toolchain.hooks | the hook manager's config file is absent | none: installing a hook manager is a dependency decision |
| `env` | built-in, no facet | a `.env`-like file the inventory can see (i.e. not gitignored) | append its name to `.gitignore` |
| `languages` | languages.programming | a code file in a language outside the list, when the tree carries that language at the extractor's own bar (two files and 1% of the code bytes, or five files); a lone Dockerfile or helper script is a trace, never a violation, and an ambiguous extension is read the way the vote reads it, so data and docs are never code | none: `fit` plans a translate step with the AI layer on ([translation.md](translation.md), ADR-0004) |
| `releases` | releases facet | `changelog: keep-a-changelog` with no changelog file at the root; a named `tool` whose root fingerprint is absent | create `CHANGELOG.md` with the format's header (and the semver line when `versioning` says so); the tool's config is report-only, like hooks, unless the pattern captured it (extract captures a release tool's root config file the way it captures a hook manager's), in which case the config rule owns it and creates it. Versioning lives in tags, and `commits` in messages, so neither is a path to check (ADR-0005) |

The `env` rule leans on ground rule 2: the inventory already applies
`.gitignore`, so "the walk saw `.env`" *is* the violation; no second
ignore-matching implementation to drift.

Violations print grouped by rule in inventory order, one line each, with
`fixable` marked; exit code is 1 when any violation remains, 0 when clean.
`--fix` prints what it fixed, then reports what it could not.

Since the M6-opening refactor (2026-08-13), a fix is *data*, not a
closure. A `FixPlan` is `create` (refused when the file exists on disk),
`append` (with an optional already-has-this-line guard), `merge` (captured
keys win, project extras survive, at an optional dotted path), or `write`,
the one overwrite, planned only by the `verbatim` binding, and every plan
is interpreted by the single executor in `check/fix.ts`. A `CheckReport`
therefore travels as JSON, which is what the daemon serves and what `fit`'s
dry-run diff builds on. Each rule implements the one `Rule` contract
(`check/rule.ts`) and lives in its own file under `check/rules/`,
mirroring extract's scanner-per-file layout; reporting order is the
`RULES` array in `check/check.ts`.

## The two new facets

- **`testing`**: `{ placement: "colocated" | "separate", filePattern:
  "{stem}.test.ts" }`. Extract votes it from where test files actually sit
  (next to the source they test, or under a test root like `tests/`) and how
  they are named; mixed evidence degrades to a counted note, per ADR-0003.
  `{stem}` stands for the source file's basename; a `filePattern` without
  `{stem}` (pytest's `test_*.py` style) checks shape only.
- **`toolchain.hooks`**: the hook manager (`husky`, `lefthook`,
  `pre-commit`), fingerprinted from its config file the same way the other
  toolchain roles are. The toolchain facet stays the one owner of tool
  identity (ADR-0003 rule 4).

## Watch

`--watch` is a debounced full re-run: fs events (recursive, with the
inventory's deny list pruned so `node_modules` churn never wakes it) reset a
short timer; when the tree goes quiet, check runs again and reprints. No
incremental diffing, no per-rule invalidation: check is fast because the
inventory is, and a boring watch cannot be subtly stale. The loop lives in
the engine (`watchProject`), not the CLI, so the GUI drives the same code
(PLAN: "all logic in core"). `--watch` refuses to combine with `--fix`: a
watcher that edits the tree it watches is a feedback loop, and fixes deserve
a human at the keyboard; `watchProject` cannot fix by construction.
