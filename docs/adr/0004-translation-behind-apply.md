# ADR 0004: Cross-language translation behind apply

- Status: accepted
- Date: 2026-08-22

## Context

PLAN's fourth pillar promises that with AI on, dolly can translate a
project into the language its pattern dictates. The AI design
([docs/design/ai.md](../design/ai.md)) set three ground rules for the
layer, and the third, "AI suggests while the deterministic engine decides",
shaped its first two consumers: placement picks among candidates the
planner enumerated, and learning drafts prose a person accepts line by
line. Translation cannot fit that shape as it stands: a translated file is
content no deterministic path can produce, and a translation that only
suggests (a sketch the user retypes) is not the feature. Fit's design
also states that deletions do not exist in fit, and a translation
replaces a file.

Two scopings were on the table: a labeled plan that never writes code,
and full translation behind apply. The maintainer chose the latter on
2026-08-22, with a design doc and this ADR before any code.

## Decision

1. **Translation is a planned step, enumerated deterministically.** The
   `languages` check rule reports every code file whose language is
   outside `languages.programming`; fit turns each into a `translate` step
   (`from`, `to`, `language`, `reason`) as data, like every other step.
   The engine decides which files, to which language, at which paths. The
   model never chooses a path.
2. **The model produces content only under `--apply`, and the engine
   judges it.** A bare `fit` never calls a model. Under apply, one call per
   file, the whole file back in one fenced block or the step fails. The
   pattern's own `commands.typecheck` and `commands.test`, when defined,
   run after every step has run; a failure commits nothing and leaves the
   tree for inspection, originals intact. Ground rule 3 of the AI design
   is restated rather than broken: the engine decides what, where, and
   whether to commit; the model fills in the bytes between.
3. **Off means absent.** With the layer off, translate steps are declined
   with the connect hint, and a plan reads exactly as it did before this
   feature existed. No deterministic path imports the translator.
4. **The one exception to "no deletions in fit".** A translate step removes
   its source file, and only then: after every step has run, after
   verification has passed, and before the commit that records the
   removal. The checkpoint branch holds the original tree, so the undo
   stays one `git switch`. No other step kind may delete, now or later,
   without its own ADR.
5. **Bounds are part of the contract.** At most 25 translate steps per
   apply and 64 KiB per source file; beyond that, steps decline with a
   reason. The dry run prints the count and bytes that would go to the
   model, so the cost is visible before a key is spent.

## Consequences

- Fit grows a third step kind and apply grows a verification stage that
  runs the pattern's own commands; a pattern without `typecheck` or `test`
  commands gets translations committed unverified, which the report says
  in so many words.
- Import lines are not rewritten across languages. Consistency between
  translated files is the model's job, given the whole mapping, and the
  verification stage is what holds it to account.
- The check rule lands first and is useful on its own: a project drifting
  into a second language is reported whether or not AI is ever turned on.
- The design doc ([docs/design/translation.md](../design/translation.md))
  carries the mechanics and the acceptance fixtures; this ADR carries the
  decision and the exception, so that a later reader knows both were
  deliberate.
