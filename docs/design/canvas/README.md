# The design canvas, in the repo

The artboards of the "dolly brand and app redesign" canvas, the place every
surface is designed and approved before it is ported (docs/PLAN.md, "How
visual work happens"). The canvas itself lives at
https://claude.ai/code/artifact/e8dce8d4-0b47-4b5f-9d23-a67c9eeb6474; these
are its boards as `.dc.html` files plus `canvas.json`, which places them on
pages, kept here so the briefs survive without the artifact and the canvas
can be re-seeded from the repo.

| Page | Boards |
|---|---|
| Logo | `Logo` (the brand sheet: the mark, sizes, the app icon, dark, and the outline it replaced), `LogoDirections` (A solid, chosen; B layered; C grounded) |
| App | `Main` (the library), `Pattern`, `Check`, `Fit` |
| Learn | `Learn` (watching, with proposals), `LearnIdle` |
| Settings | `SettingsAi`, `SettingsAiOff` |
| Export | `Export` (after a save), `ExportExists` |
| Flows | `LibraryExtract`, `LibraryImport`, `PatternNew` |
| Conventions | `PatternProse` (the pattern view with its conventions panel rendered from markdown; proposed 2026-09-01, awaiting approval) |

Each board is a plain HTML fragment inside `<x-dc>`, styled inline in the
palette of `apps/desktop/src/theme.css`; open one in a browser to see it (the
`support.js` it references is the canvas runtime and is not needed for a
look). `assets/logo.svg` and `assets/app-icon.svg` are the brand sheet's
mark, written out from its geometry.
