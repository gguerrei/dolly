# ADR-0002: A pattern is a directory with a Markdown document at its heart

- **Status:** accepted
- **Date:** 2026-07-24

## Context

Patterns must be: hand-editable and deletable by users (a hard product requirement), diffable in git, shareable between users, machine-checkable by a deterministic engine, and exportable as skills/agents for LLMs. Alternatives considered: pure YAML/TOML (machine-friendly but hostile to prose conventions), a database (lock-in, not editable), JSON (miserable to hand-edit).

## Decision

A pattern is a **directory** named after the pattern:

```
<name>/
├── pattern.md      # YAML frontmatter + Markdown prose
└── templates/      # optional file templates for scaffolding
```

`pattern.md` has two halves with a deliberate split of responsibilities:

- **YAML frontmatter**, the *facets*: machine-readable, zod-validated (`format: 1` for future migrations), the only thing the deterministic engine reads. Unknown keys are rejected so typos fail loudly.
- **Markdown body**, the *prose conventions* only humans and the (optional) AI layer interpret. The engine never parses it, so it can never break.

Sharing a pattern = zipping the directory into a `.dolly` bundle. Patterns live under the platform data dir (`~/.local/share/dolly/patterns` on Linux), overridable via `DOLLY_HOME`.

## Consequences

- One format serves the GUI editor, `$EDITOR`, git diffs, and sharing; no converters.
- The file is already skill-shaped: LLM exports (Claude skills, cursor rules, AGENTS.md) become renderings of `pattern.md`, not translations.
- Facets and prose can drift apart in meaning; extract (M2) mitigates by writing low-confidence findings into prose as notes rather than inventing facets.
- YAML's quirks are contained by strict zod validation on load.
