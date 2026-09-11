# GUI: design

How dolly gets a face: a local daemon (`dolly serve`) that is the engine's
one door, and a webview app (`apps/desktop`) that browses, edits, and checks
through it. Designed at M5; two maintainer decisions (2026-08-12) shape it:
the webview is **Vue 3 + Vite**, and the milestone lands **web-first**. The
daemon and UI were built and verified in a browser first; the Tauri shell
(wrapped 2026-08-13, "The native shell" below) is a window around that same
pair, so nothing web-first built was thrown away.

## Ground rules

1. **One engine, one door.** The GUI never links `@dollysheep/core`; it speaks
   HTTP/JSON to `dolly serve`, which binds the same curated barrel the CLI
   binds. CLI/GUI parity holds by construction, exactly as `watchProject`
   already proved: the engine owns behavior, the edges only render it.
2. **The daemon is a verb of the one binary.** `dolly serve` lives in
   `dollysheep` beside the other verbs (one install, one door) and stays
   thin the way the CLI is thin: every route is a barrel export plus a JSON
   view, no logic of its own. Since M6 made fixes serializable data, a
   report crosses the wire as itself; the check view only collapses each fix
   to `fixable: true`, since the GUI acts on plans rather than parsing them.
3. **Local means proven local.** The daemon binds 127.0.0.1 only, and every
   `/api` request must carry a per-run random bearer token in the
   `Authorization` header. The token rides the printed URL's *fragment*
   (`#token=…`, never sent on the wire, never loggable), the header is one
   a cross-site request cannot forge (no cookies, ever; that is the CSRF
   defense), and a `Host` header that is not localhost is refused outright
   (the DNS-rebinding defense). A website open in the next tab can know the
   daemon exists; it cannot speak to it.
4. **The daemon serves its own face.** `/` serves the built webview
   (`apps/desktop/dist`) when it exists, so `dolly serve` *is* the GUI until
   the native shell lands: one origin, no CORS surface. In development,
   Vite's dev server proxies `/api` to a running daemon.
5. **Writes stay the writes check defined.** The HTTP surface adds no power
   the CLI does not have: saving a pattern is `dolly edit`'s
   validate-then-write, fixing is `check --fix`'s create/append/merge, and
   watch cannot fix by construction (it streams `watchProject`, which has no
   fix parameter to pass). Deleting a pattern is the one destructive route,
   and the UI confirms it like the CLI makes you type the name.

## The protocol

Default port 36559 ("dolly" on a phone keypad) with `--port` to override
(`--port 0` for an ephemeral port, which is how the tests run). JSON in,
JSON out; errors are `{ "error": message }` with honest status codes (401
missing/wrong token, 404 unknown pattern, 400 invalid name, 422 a pattern
that does not validate).

| Route | Binds | Notes |
|---|---|---|
| `GET /api/health` | n/a | `{ name: "dolly", version, home }`, the GUI's liveness probe; `home` is the store's directory as a shell would print it, for the library's head |
| `GET /api/ai` | `aiStatus` | `dolly ai status` as JSON, for the sidebar's AI line |
| `GET /api/patterns` | `PatternStore.list` | summaries, broken patterns flagged not hidden |
| `GET /api/patterns/:name` | `PatternStore` + `parsePatternDocument` | raw `source` always; parsed `pattern` + `prose`, or `error` when invalid (the editor needs broken patterns most) |
| `PUT /api/patterns/:name` | `parsePatternDocument` + verbatim write | `dolly edit` over HTTP: body is raw source, validated first; valid source is written byte-for-byte (the author's formatting is theirs), invalid is 422 with the parse error and nothing written |
| `DELETE /api/patterns/:name` | `PatternStore.delete` | |
| `POST /api/check` | `checkProject`, or `assistedCheck` with `conventions` (+ `resolvePattern`) | `{ dir, pattern?, fix?, conventions? }`; pattern falls back to the project's `.dolly` marker (its `source` picks the store), same resolution order as the CLI; `conventions: true` adds the model's reading of the prose, a 400 with AI off |
| `POST /api/fit` | `assistedFit` / `assistedFitApply` (+ `gitStateOf`) | `{ dir, pattern?, apply? }`; the `FitPlan` is data end to end, so it crosses the wire as itself (each fix step with its `preview`, the patch as a unified diff), plus `git` so the UI can gate Apply; with AI on, declined items may carry a `suggestion` and steps may be `translate`; apply's git preconditions come back as 409 |
| `GET /api/ai/providers` | `aiProviders` | every provider with its label, default model, and where its key lives |
| `POST /api/ai/connect` | `connectAi` | `{ provider, key }`: verified live, then stored in the OS keychain; the provider's refusal is a 400 in its words |
| `POST /api/ai/use` | `useAi` | `{ provider, model? }` |
| `POST /api/ai/off` | `aiOff` | the selection forgotten, keys kept |
| `GET /api/learn?dir&pattern` | `watchLearning` | the learn stream: one NDJSON line per re-learn, `{ proposals, changed }`, the watcher stopped when the client goes away |
| `POST /api/learn` | `saveLearned` | `{ dir, pattern?, accepted }`: the review's outcome written together; a captured path that leaves the pattern directory is a 400 |
| `POST /api/learn/draft` | `draftConventions` | `{ dir, pattern?, changed, proposals }`: the session's one model call, an empty list with AI off |
| `GET /api/export?as&pattern` | `renderExport` | the preview: `{ target, path, contents }`, a pure function of the pattern; `as` is one of the text targets, and `dir` stands in for `pattern` when the project's marker should name it |
| `POST /api/export` | `exportPattern` | `{ dir, pattern?, as, force? }` writes the file at the target's own path under `dir` (409 until `force`); `{ out, pattern, as: "bundle" }` writes the bundle where the native save dialog chose |
| `POST /api/extract` | `extractPattern` or `extractFromRepos` + `saveExtractedPattern` | `{ dir, name?, force? }`, or `{ dirs, name, force? }` to keep what several projects agree on: what was saved, the way `dolly extract` says it; an existing name is 409 until `force` |
| `POST /api/new` | `scaffoldProject` | `{ pattern, dir }`: the `ScaffoldReport`; a directory that is not empty is 409 |
| `POST /api/import` | `importBundle` | `{ file, force? }`: the pattern the bundle held, from a path or an https URL; an existing name is 409 until `force`, a file that is not a bundle 400 |
| `POST /api/link` | `linkProject` | `{ dir, pattern, vendor? }`: `dolly link` over the wire; the marker written, an ignore list and rule settings already there kept, `replaced` naming the pattern the project was linked to before, and with `vendor` the pattern copied into the project (`vendored` names the directory) |
| `POST /api/ignore` | `ignorePaths` | `{ dir, paths }`: `dolly ignore` over the wire; the paths appended to the marker's ignore list, the marker returned whole |
| `GET /api/watch?dir&pattern` | `watchProject` | a held-open response streaming one JSON report per line (NDJSON, not SSE: `EventSource` cannot send the auth header, `fetch` can); closing the request disposes the watcher |

The check view strips each violation to
`{ rule, path, message, fixable }`; the closure itself stays engine-side.
Extract, new, import, and the bundle export waited for the native shell's
pickers (M9) and joined with them: inside the shell every path field has
a Browse button beside it (`lib/native.ts`, the one seam to Tauri, and
only for dialogs; the engine stays behind the daemon), and in a plain
browser the same flows take a typed path, as check always has.

## The webview

Vue 3 single-file components, Vite, no router, no state library. The page
is an app shell in the shape of a shipped desktop product (redrawn
2026-08-21 after the brand refresh): a sidebar (the mark and wordmark, a
labeled iconed nav, and a status footer with the AI line from
`/api/ai` and the daemon line, version plus a live dot that turns warm
when the daemon is unreachable), then a main column with a top bar
(breadcrumbs, and a search button that opens the ⌘K palette listing every
view and every saved pattern) over the content. Seven views behind a hash
(`#/`, `#/pattern/<name>`, `#/check`, `#/fit`, `#/learn`, `#/export[/<name>]`, `#/settings`), switched by a ref:

- **Library**: how many patterns are saved and where, then every saved
  pattern as a table row (name, description, facet chips, a validity badge,
  delete on hover), broken ones flagged the way `dolly list` flags them. Entry point to the other views, and where
  patterns arrive: Extract a project and Import a bundle open inline
  panels under the head (a path, Browse in the shell, a name for
  extract), and a name already in the library comes back as Replace or
  Keep mine.
- **Pattern**: New project opens an inline panel (the target directory,
  picked or typed, then the scaffold report with its next steps); Export
  leads to the export view. Below, an *Overview* of the facets as a two-column grid of panels
  (project, with the two history facets as one line each; toolchain with
  its captured configs, commands, the conventions rendered from their
  markdown since 2026-09-01, headings in the panel's own vocabulary and
  bullets as a list, folding past three notes behind Show all; layout
  with its required badges, naming, testing, dependencies), and a
  *Source* mode over the raw `pattern.md` with the CLI's validate-on-save
  loop: a 422 shows the parse error inline and keeps editing, never losing
  the buffer.
  The editor is CodeMirror 6 with YAML awareness, themed entirely from the
  palette's CSS variables so one theme serves both schemes: keys carry
  weight, comments and strings shade grey, literals take the one warm
  tone; deliberately not a rainbow.
- **Check**: a project directory (typed, remembered in `localStorage`),
  the pattern resolved from its marker or picked explicitly, then: run,
  fix, or watch (a toggle that holds the NDJSON stream open and repaints
  on every report). The report renders as four stat tiles (counts in
  tabular numerals, the violation count in the warm tone) over one panel
  per rule, diagnostics kept visually apart as the pattern author's
  problem.
- **Fit**: the same directory (shared with Check via `localStorage`),
  then Plan: moves with their import rewrites as subordinate lines, fixes
  with their plan kind and, since 2026-09-01, the patch each would make as
  a diff under its row (a dozen lines, then Show all), each move wearing
  the rule that asked for it,
  translations with their target language and what
  would go to the model under Apply, and a "left to you" group for
  everything fit declined, each with its reason. After an apply, the
  verdict of the pattern's typecheck and test commands shows beside the
  checkpoint line. Apply is enabled only when the daemon
  reports the git tree clean (the button's tooltip names the missing
  precondition otherwise), and the checkpoint branch is shown after, so
  the undo is always one `git switch` away.

- **Learn**: the same project fields, then Learn holds the daemon's learn
  stream open and lists every proposal as a panel: its path, its reason,
  the diff it would make (to `pattern.md`, or to the captured file when
  the bytes moved), and an accept or skip pair. Stop watching asks the
  model once, with AI on, and the convention drafts join the list wearing
  the model's name. Write sends the accepted set to `POST /api/learn` and
  drops what was written; the watcher re-learns the rest on its next pass.

- **Export**: the same project fields (the pattern resolved from the
  marker when the field is empty, or carried in from the pattern view's
  Export button), the target list on the left (AGENTS.md, Claude skill,
  Cursor rule, system prompt, each with the path it lands at; the `.dolly`
  bundle as its terminal command), and the rendered file on the right,
  refreshed on every change since it is a pure function of the pattern.
  Save into project writes it at the target's own path under the
  directory; a file already there comes back as a callout with Replace
  and Keep mine, never overwritten silently. Copy puts the text on the
  clipboard.

- **Settings, AI**: reached from the sidebar's AI line, `dolly ai` verb for
  verb. Each provider with its default model and where its key lives, Use
  for the active one, Connect opening a form whose key is verified live
  before the keychain stores it (a refusal shows in the provider's words and
  keeps the form), the model field, and the switch; Off keeps the keys. A
  pasted key travels to the daemon over loopback with the session token,
  the same trust as a key pasted into the CLI. The sidebar line and the
  view read one shared status (`lib/ai.ts`), fetched on demand and never
  on a timer, because the key lookup behind it can raise an OS keychain
  prompt.

Feedback is never silent: saves, deletes, and fixes toast; loads show
skeletons; empty states show the mark and the next command to run.

Theme: the sheep palette (white, black, and greys only), both modes via
`prefers-color-scheme`, with Inter self-hosted so typography does not
depend on the host OS (everything ships in the bundle; the daemon's CSP
posture and the future Tauri webview both demand offline-complete assets).
Accent color is whatever the violation state is: nothing when clean, one
warm tone when not. The mark (redrawn 2026-08-21) is the two-headed
sheep as one solid silhouette: five scallops over a rounded base, the
heads as the ends of the body facing outward, eyes knocked out in the
background colour so it stays one ink and reads from a 16px favicon to
the store tile. `assets/app-icon.svg` is its rounded-square tile for the
native shell, and `bun run tauri icon ../../assets/app-icon.svg` from
`apps/desktop` regenerates the icon set. Biome checks the app's `.ts` and CSS; `.vue` files are excluded
(`biome.json` `files.includes`) because Biome parses only their script
blocks and misreads template usage as dead code; `vue-tsc` owns them.

## Design canvases

Every surface starts on a Claude Design canvas and is approved there before it is ported (PLAN, "How visual work happens"). The canvases so far:

- Brand sheet, logo directions, the four app views of the 2026-08-21 redesign, the Learn page (the learn view watching with proposals, and idle; approved and ported 2026-08-21), the Settings page (the AI surface on and off; approved and ported 2026-08-22), the Fit board's translations panel (ported 2026-08-22 to close M7, on the canvas for a look), the Export page (the view after a save, and the view when the file already exists; approved and ported 2026-08-22), the Flows page (the library extracting a project and importing a bundle, the pattern view scaffolding a new project; designed and ported 2026-08-23, on the canvas for a look), and the Conventions and Previews pages (the pattern view rendering its markdown, the fit view showing each fix's patch; approved and ported 2026-09-01): https://claude.ai/code/artifact/e8dce8d4-0b47-4b5f-9d23-a67c9eeb6474

The boards are also kept in the repo under [docs/design/canvas/](canvas/README.md), one `.dc.html` per board plus the `canvas.json` that places them, so a session without the artifact can still read the briefs and re-seed the canvas from here.

## The native shell

The Tauri app (`apps/desktop/src-tauri`, wrapped 2026-08-13 once the
toolchain landed) is a window around the same pair: `lib.rs` spawns
`dolly serve` on an ephemeral port, reads the tokened URL off the daemon's
stdout, points the webview at it, and kills the daemon on exit. The
config declares no windows: the window can only exist once the URL does.
No engine bindings in Rust, ever; the daemon stays the one door, which is
why the whole shell is one small file plus the dialog plugin: the
capability in `capabilities/default.json` grants the page the daemon
serves (`http://127.0.0.1:*`) the open and save dialogs and nothing else,
and `withGlobalTauri` is how the webview finds them without being built
by Tauri. Still to come here: a bundled compiled daemon as a true sidecar;
for now the shell presumes a checkout with `bun` on the PATH. Prerequisites and commands live in
`apps/desktop/README.md`.
