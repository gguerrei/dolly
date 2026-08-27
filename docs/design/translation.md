# Cross-language translation: design

How `dolly fit` brings a project to the language its pattern dictates when
the project is written in another one. M7's last and largest piece,
scoped by the maintainer on 2026-08-22 as **full translation behind
apply**: the model rewrites files into the pattern's language, and
`fit --apply` commits them behind the checkpoint branch. The decision
itself, and the exception it carves, are recorded in
[ADR-0004](../adr/0004-translation-behind-apply.md); this document is the
mechanics.

The shape follows fit's own: the deterministic engine decides *what*
(which files, to which language, at which paths), the model produces
*content*, and the engine verifies the result and decides whether any of
it is committed. Off means absent, as everywhere in the AI layer: with the
layer off, every translate step is declined with its reason and nothing
else changes.

## Ground rules

1. **The pattern dictates through `languages.programming`.** The list is
   the sanctioned set, dominant language first. A code file whose
   extension belongs to a language outside that list is off-pattern; a
   file whose extension belongs to no language (data, docs, assets) is
   not code and is never judged. The target of a translation is the
   pattern's dominant language, and the target path is the source path
   with that language's primary extension (`src/auth/login.py` to
   `src/auth/login.ts`). Naming and placement rules apply to the result
   like any other file, on the next fit.
2. **Check reports, fit plans, apply executes.** A new deterministic rule,
   `languages`, reports every off-pattern code file ("written in Python;
   the pattern sanctions TypeScript"), never fixable. Fit turns each into
   a `translate` step, data like every other step: `{ kind: "translate",
   from, to, language, reason }`. With the AI layer off the step is
   declined ("translation needs the AI layer; `dolly ai connect` turns it
   on"), so a plan without AI looks exactly as it did before this feature
   existed.
3. **One file, one call, the whole file back.** Under `--apply`, each
   translate step sends the model the pattern's prose and facets, the
   source file, the full list of planned translations (so a caller and its
   callee are renamed consistently), and up to three already translated
   files from the same plan as examples of the house style. The reply must
   be one fenced code block holding the entire translated file; anything
   else fails that step. A failed step never writes. Bounds keep cost and
   blast radius flat: at most 25 files per apply and 64 KiB per source
   file; larger plans decline the excess with a reason, and the dry run
   prints the count and bytes that would go to the model.
4. **Verification before any deletion, deletion before any commit.** The
   translated file is written beside its source. Once every step of the
   plan has run, the pattern's own `commands` are the judge: `typecheck`
   and `test`, when the pattern defines them, run in the project. If
   either fails, the tree is left as it is for inspection (originals
   intact, translations beside them, nothing committed) and the failure is
   reported with the command's output. Only when verification passes are
   the source files removed and the plan committed. The checkpoint branch
   holds the original tree either way, so the undo is still one
   `git switch`.
5. **The engine never rewrites what it cannot see.** Importers of a
   translated file written in the old language are themselves off-pattern
   and in the same plan; importers in the new language are the model's to
   keep consistent, which is why every step sees the whole mapping. Fit
   does not rewrite import lines across languages: the verification step
   is what catches a broken reference, and a broken reference is a failed
   apply, not a silent one.

## What apply does, in order

1. Refuse a dirty tree, create the checkpoint branch (fit's rule 2).
2. Run fix and move steps as today.
3. For each translate step, in plan order: one model call, the whole
   file written to `to`. A step that fails is recorded and the run
   continues, so the report names every failure at once.
4. If any step failed: stop, commit nothing, report.
5. Run the pattern's `typecheck` and `test` commands, when defined, in the
   project root with the project's own bins (`node_modules/.bin`,
   `.venv/bin`) ahead of the PATH. A non-zero exit is a
   failed verification: stop, commit nothing, report the output.
6. Remove every translate step's source file, `git add -A`, commit
   `dolly fit <pattern>`. The result: a project that `dolly check` reads
   as on-pattern for `languages`, and a second `fit` that plans nothing.

## What v1 does not do

- Translate across runtimes' build systems: a `pyproject.toml` does not
  become a `package.json`. The toolchain facet's fixes and the `commands`
  facet already carry the new manifest through check's fixes where the
  pattern captured one; the rest is the author's.
- Translate tests into a different framework than the pattern's
  `testing` facet implies. The model is told the placement and file
  pattern; whether the result runs is what step 5 checks.
- Keep both languages. A translate step replaces; a project that wants
  two languages lists both in `languages.programming` and nothing is
  planned.

## Acceptance

A small Python project against a TypeScript pattern that captured
`commands.typecheck` and `commands.test`: the dry run lists every `.py`
as a translate step with its target path and the count and bytes bound
for the model; with AI off, the same steps are declined with the connect
hint and nothing else changes. With AI on and the provider stubbed to
return well-formed TypeScript, `--apply` writes the translations, runs the
commands, removes the sources, and commits; `dolly check` then reports no
`languages` violation and a second `fit` plans nothing. With the stub
returning prose instead of a code block, the step fails, nothing is
removed, nothing is committed, and the checkpoint branch restores the
tree. With the stub returning TypeScript that fails the typecheck
command, the same holds, with the command's output in the report.
