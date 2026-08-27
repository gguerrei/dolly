# fit: design

How `dolly fit <pattern> [--apply]` brings an *existing* project to a
pattern: the migration planner that does what check refuses to (moves and
renames) plus everything `check --fix` already could, behind a dry-run
diff. Designed at M6; one maintainer decision (2026-08-13) shapes it: **v1
rewrites relative TS/JS imports** where the resolution is unambiguous, and
any move it cannot rewrite safely degrades to report-only.

Said plainly (2026-08-14, after the product audit): **v1 fit is a TS/JS
migration tool.** Everywhere else it still applies check's fixes, but it
declines moves with their reasons: a Python module's importers, a
markdown link, a CI script's path are all invisible to the import ledger,
and "no importers found" must never be allowed to read as "accounted
for".

An ambiguous decline (several same-stem sources, several test roots)
also enumerates the concrete destinations the planner refused to pick
between, as `candidates` on the declined item. With the AI layer on
([docs/design/ai.md](ai.md)), the model picks one of those candidates
and the pick rides along as a labeled suggestion; apply never reads it.

## Ground rules

1. **Dry-run is the mode; --apply is the exception.** A bare `dolly fit`
   never writes: it prints the full plan as a diff-shaped preview of every
   file created, merged, moved, renamed, and every import line the moves
   will touch. `--apply` executes exactly that plan, nothing discovered
   along the way.
2. **Git is the safety net, and it is mandatory.** Fit refuses a dirty
   working tree outright, and `--apply` first creates a checkpoint branch
   (`dolly/fit-<pattern>-<n>`) at HEAD: "fully revertible" means
   `git switch` back, not trusting dolly's memory of what it did.
3. **Fit plans in the same currency as check.** The plan is data end to
   end: check's rules run first and their `FixPlan`s are adopted verbatim
   (create/append/merge, applied by the same one executor); fit adds the
   two step kinds check refuses: `move` (which covers renames: a rename
   is a move that stays in its directory) and the `rewrite` steps a move
   induces. One executor per step kind, no closures anywhere.
4. **A move must account for its imports or not happen.** For each planned
   move, fit scans the project's TS/JS-family files (`.ts/.tsx/.mts/.cts/
   .js/.jsx/.mjs/.cjs`) for *relative* import specifiers that resolve to
   the moved file (or through a moved directory) and plans the exact line
   rewrites. Anything it cannot resolve unambiguously (non-relative
   specifiers, dynamic imports built from strings, extensionless
   collisions) downgrades that move to report-only with the reason
   printed. And the rule cuts both ways, enforced (2026-08-14): a move of
   any file *outside* those extensions declines outright ("dolly cannot
   yet account for references to .py files"), and the presence of importer
   types the ledger cannot open (`.vue`, `.svelte`, `.astro`, `.mdx`)
   declines every move; those files import invisibly, so nothing is
   accountable. A testing move whose source the pattern's own layout
   demands in place declines too: that is the pattern contradicting
   itself, the author's to settle. Never a broken import applied silently.
5. **The engine owns fit; the edges render it.** `fitProject` lives in
   `@dolly/core` behind the barrel, the CLI prints the plan and asks
   nothing else, and the daemon can serve the same plan as JSON when the
   GUI grows a fit view. CLI/GUI parity by construction, as everywhere.

## What v1 plans

| Source | Violation | Fit step |
|---|---|---|
| check's fixable violations | any | the `FixPlan` as-is (create/append/merge; `write` for verbatim) |
| `naming` | file off-convention | `move` to the conventional name + import rewrites |
| `naming` | directory off-convention | `move` of the directory + prefix rewrites of every import through it |
| `testing` | placement wrong | `move` to the pattern's placement + import rewrites |
| `layout` | required `{name}` entry with no instance | still a human decision; report-only |
| `languages` | code file in a language the pattern does not sanction | `translate` to the pattern's dominant language, with the AI layer on; declined with the connect hint otherwise ([translation.md](translation.md), [ADR-0004](../adr/0004-translation-behind-apply.md)) |
| anything else report-only | n/a | reported, with check's own message |

Deletions do not exist in fit, with one exception carved by ADR-0004: a
translate step removes its source file, after every step has run and the
pattern's own `typecheck` and `test` commands have passed, and before the
commit that records it. Everywhere else dolly refuses to destroy content it
did not invent.

## Acceptance

Refit a deliberately messy repo (wrong-case filenames, tests in the wrong
place, missing configs): the dry run previews every change including exact
import rewrites; `--apply` lands them; the project then passes
`dolly check` clean; `git switch` to the checkpoint branch restores the
original tree byte-for-byte; and running `fit` again plans nothing.
