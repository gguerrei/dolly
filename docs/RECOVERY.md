# Recovery notes

This tree was reconstructed on 2026-08-26 and 27 from the logs of the three Claude Code remote control sessions that built it (the original machine was wiped and the repository had never been pushed). The method, the sources and the confidence per area are described in `../README.md` of the salvage folder; this file keeps what a maintainer of the code needs to know.

## State

Last original commit: `74a1684`, 2026-08-23, "feat: M9 opens with the shell's pickers and the flows they unlock". The tree here corresponds to that commit, with the exceptions listed under "Reconstructed" and "Known gaps". Gate on 2026-08-27 (macOS): Biome clean, `tsc` and `vue-tsc` clean, Vite build ok, 248 tests passing and 8 skipped (the Linux only keychain tests), none failing.

## Exact, reconciled, reconstructed

Exact means the last state of the file was a full write or a full read in the logs, or was rebuilt from one plus every later edit, and every verbatim fragment printed afterwards matches. That covers most of `packages/core/src`, `packages/cli`, the manifests, `biome.json`, `tsconfig.json`, the Tauri config and capabilities, `assets/`, `App.vue`, `theme.css`, `api.ts`, `router.ts`, `main.ts`, the components, `LearnView`, `SettingsView`, `ExportView`, `docs/design/gui.md`, `docs/design/ai.md`, ADR 0003 to 0005, `README.md`, `CHANGELOG.md`, `docs/PLAN.md` (head and the 2026-08-21 to 23 log entries), `apps/desktop/README.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `CODE_OF_CONDUCT.md` (first 30 lines and byte size verified).

Reconciled means the base was an older snapshot and later edits were applied on top, verified against every fragment the logs show. Where the Aug 14 writing sweep (done by subagents whose transcripts are gone) reworded a comment or string and no later output prints it again, the rewording here follows the same rule but is not the original's words. Files with such reconstructed wording: `packages/core/src/check/{check,fix,support}.ts` and `check/rules/{naming,env,hooks,layout}.ts`, `packages/core/src/extract/{capture,commands,globs,registry,layout,scaffold,testing,toolchain}.ts`, `packages/core/src/{store,marker,serialize,taskfile}.ts`, `packages/core/src/tree/inventory.ts`, `packages/core/src/apply/{imports,licenses}.ts`, `packages/core/test/{check,layout,extract}.test.ts` (a few comments and titles), `docs/design/{check,extract,new,fit}.md` (the middle sections), ADR 0001 and 0002, `CONTRIBUTING.md`, `SECURITY.md`, ten early paragraphs of the `docs/PLAN.md` session log, and the wrap of a few `CHANGELOG.md` lines.

Reconstructed means no captured text existed and the file was rebuilt from its sources:

- `apps/desktop/src/views/LibraryView.vue`, `PatternView.vue`, `CheckView.vue`, `FitView.vue`: the Aug 22 redesign port was done by subagents. Rebuilt from the verbatim ranges the logs print afterwards (large for Library, Pattern and Fit), the later edits recovered from the logs (the M9 flows are verbatim), the design boards, and the sibling views. Small ranges never printed (the loading skeleton and two computeds in Pattern, the zero steps message and the diagnostics callout in Fit, the per rule tally copy in Check) are reconstructed to fit the recorded line counts.
- `packages/core/src/apply/licenses.ts`: commit `8524394` (Aug 10, "harden the scaffolder") came from a session that was not remote controlled; its guard in `renderLicense` against Object.prototype member ids is reconstructed as `Object.hasOwn(TEXTS, id)`, which is what the existing test needs.
- `.github/ISSUE_TEMPLATE/feature_request.yml` in full and `bug_report.yml` after line 25.
- Regenerated: `packages/core/src/extract/languages-data.json` (`bun packages/core/scripts/generate-languages.ts`, 814 languages), the Tauri icon set (`bun run tauri icon ../../assets/app-icon.svg` from `apps/desktop`), `apps/desktop/src-tauri/build.rs`, `src/main.rs` and `.gitignore` (standard Tauri v2 boilerplate), `bun.lock`.

## Known gaps

- Anything else commit `8524394` changed that no later snapshot or fragment shows. The rest of that commit's files were read in full later, so the loss is limited to that guard.
- `packages/core/src/extract/dependencies.ts` and `naming.ts` still contain em dashes in note strings and comments. That is original: both files carried literal NUL bytes at the time of the sweep and its grep skipped them as binary. `naming.ts` here writes the NUL as the `\0` escape (the original session did the same fix in `dependencies.ts` on Aug 22).
- The orphaned doc comment above `readTomlSafe` in `packages/core/src/extract/toolchain.ts` is original (its function moved to `taskfile.ts` on Aug 22); delete it when convenient.
- `docs/design/fit.md`: the original's last edit accidentally removed the blank line after the table, which would have merged the following paragraph into it; the blank line is kept here.
- `README.md` still says the native Tauri shell "comes later" in two places; that is the original text at `74a1684`.
- `Cargo.lock` and `apps/desktop/src-tauri/gen/` are generated on the first `cargo` build (Rust is not installed on this Mac).
- Found and closed on 2026-08-27: `assets/logo.svg`, `assets/app-icon.svg`, `apps/desktop/public/logo.svg` and the Tauri icon set had come back at their Aug 13 line art state, not the solid silhouette commit `3f927b5` shipped. The Aug 21 session drew the delivered files from a scratchpad script whose output the replay never had, so the copies of that day were skipped without a trace. The mark was rewritten from the canvas brand sheet's geometry (`docs/design/canvas/Logo.dc.html`), the icon set regenerated, and the boards themselves now live in `docs/design/canvas/`.
- The four reconstructed views were checked against their boards on 2026-08-27 through the built webview (docs/PLAN.md, that day's entry); what differed was aligned in the same pass.
- Git history: only the messages and hashes below survive. This repository starts with a single commit.

## Original commit history

| Date (UTC) | Commit | Subject |
|---|---|---|
| 2026-07-24 04:10 | `f73f61a` | chore: bootstrap the dolly monorepo |
| 2026-07-24 05:11 | `77317c8` | feat: complete the v1 pattern schema, editing and shareable bundles |
| 2026-07-24 19:14 | `f903c34` | feat: extract patterns from real projects deterministically |
| 2026-07-24 19:24 | `c8f6e26` | fix: read parameterized just recipes and stop counting assets as code |
| 2026-07-25 00:20 | `bc042ae` | feat: scaffold fresh projects with dolly new, plus commands and license facets |
| 2026-07-25 00:39 | `1135a2e` | feat: capture file templates from agreeing siblings and instantiate them |
| 2026-08-11 14:03 | `e68f838` | fix: close eleven review findings across the path gate, license, commands, and scaffolder |
| 2026-08-11 14:25 | `b554cce` | feat: enforce patterns with dolly check, plus the testing facet and hook fingerprints |
| 2026-08-11 14:49 | `4728577` | fix: close the two M4 soft spots — presence binding and testing-aware seeds |
| 2026-08-11 15:28 | `9593dd5` | fix: close every verified finding from the whole-project architecture review |
| 2026-08-13 01:15 | `e9519f8` | feat: give dolly a face — the serve daemon and the web-first M5 GUI |
| 2026-08-13 02:32 | `c50100f` | feat: the caliber pass — app shell, CodeMirror editor, Inter, geometric mark |
| 2026-08-13 14:36 | `25322e3` | fix: seat the ears on the crown of each head |
| 2026-08-13 14:43 | `0a3287f` | feat: the native shell — a Tauri window around dolly serve |
| 2026-08-13 15:06 | `e9e1c14` | fix: reshape the heads to the maintainer's sketch — ears hang from the top line |
| 2026-08-13 22:02 | `84c16d6` | refactor: fixes become data — FixPlan, one executor, rules behind one contract |
| 2026-08-13 22:06 | `ad67a39` | refactor: the shared helpers get named homes — tree/, serialize.ts, apply/content.ts |
| 2026-08-13 22:08 | `1896d4c` | test: the layout scanner's voting constants become falsifiable |
| 2026-08-13 22:09 | `e0c8d0e` | docs: record the M6-opening refactor — fixes-as-data, named modules, falsifiable voting |
| 2026-08-13 22:34 | `e53d46e` | docs: design fit — dry-run planner, moves with import rewrites, checkpoint branch |
| 2026-08-13 22:49 | `1b827da` | feat: dolly fit — the migration planner lands |
| 2026-08-14 02:51 | `f23d78c` | feat: the GUI grows a fit view — the plan crosses the wire as itself |
| 2026-08-14 03:04 | `bbdd623` | fix: the audit's defect class — license fingerprints, colliding creates, fit's blind spots |
| 2026-08-14 03:17 | `310400a` | fix: the code review's eight — fit's guards now see what apply will do |
| 2026-08-14 03:19 | `79cf566` | feat: naming is about code — the vote and the rule scope to the languages facet |
| 2026-08-14 03:23 | `1f4cd61` | feat: merges are minimal edits — tabs, comments, and the author's shape survive |
| 2026-08-14 03:25 | `88622be` | feat: the hooks facet earns its keep, and scaffolds wear the pattern's case |
| 2026-08-14 03:26 | `91a1c90` | docs: record the review's eight and the audit's three approved changes |
| 2026-08-14 22:09 | `e348a21` | style: every word reworded, and the writing rule made standing |
| 2026-08-14 22:10 | `48d4649` | feat: M7 opens with dolly ai, the BYOK foundation |
| 2026-08-14 22:37 | `60bbdd2` | feat: semantic placement, the AI layer's first consumer |
| 2026-08-22 00:17 | `3f927b5` | feat: the mark becomes one solid silhouette |
| 2026-08-22 00:46 | `f61ffa2` | feat: learning mode, the AI layer's second consumer |
| 2026-08-22 01:28 | `9afd735` | feat: design steps join the plan, and the daemon learns |
| 2026-08-22 01:36 | `d93792b` | feat: the learn view, ported from the approved board |
| 2026-08-22 03:05 | `588cff8` | docs: the AI settings surface goes on the canvas |
| 2026-08-22 03:21 | `35616ea` | feat: the AI settings surface, ported from the approved board |
| 2026-08-22 03:24 | `72a64b3` | docs: translation designed, and ADR-0004 records the decision |
| 2026-08-22 03:32 | `d083e5f` | feat: cross-language translation, engine first |
| 2026-08-22 03:32 | `efc7369` | test: a quote the stub's reply can carry |
| 2026-08-22 04:03 | `bf993ac` | feat: M7 closes, with translation in the fit view |
| 2026-08-22 04:18 | `75577bc` | refactor: the project-wide review, forty-one findings applied |
| 2026-08-23 02:33 | `429054d` | feat: M8 opens, exports and the history facets |
| 2026-08-23 02:36 | `1eb8881` | docs: the export view designed on the canvas |
| 2026-08-23 02:55 | `5e55c3c` | feat: M8 closes, with the export view ported |
| 2026-08-23 03:46 | `74a1684` | feat: M9 opens with the shell's pickers and the flows they unlock |

Full commit messages, in order:

### f73f61a (2026-07-24)

chore: bootstrap the dolly monorepo

First working slice of dolly. The core package holds the pattern model
(pattern.md with YAML facets plus Markdown prose) and a local pattern
store. The CLI covers list, show, delete and home. Tooling is bun
workspaces with Biome and strict TypeScript, tested on three platforms
in CI. Docs include the roadmap, two ADRs and the usual open source
hygiene files, plus the line art sheep logo.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012iwLXzR5W8b5BY4WSfNY9T

### 77317c8 (2026-07-24)

feat: complete the v1 pattern schema, editing and shareable bundles

Patterns gain a dependencies facet that records libraries by purpose
along with a version policy. dolly edit opens your editor and validates
what you saved, offering to reopen on mistakes. Patterns now travel as
.dolly bundles through dolly export and dolly import. Imports validate
the whole bundle before touching the store and refuse oversized
archives, while exports skip symlinks so a shared bundle can never
leak files from outside the pattern directory.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012iwLXzR5W8b5BY4WSfNY9T

### f903c34 (2026-07-24)

feat: extract patterns from real projects deterministically

M2 lands the heart of the product. One shared inventory walk (gitignore
semantics, build-output deny lists, a generated-code filter, symlinks
skipped, NFC paths in one deterministic order) feeds five pure scanners:
layout generalizes the tree with sibling-shape voting so src/users,
src/orders and src/billing become src/{name}/ and routers/users.py
becomes routers/{name}.py; naming votes case conventions with a global
default plus per-extension overrides; toolchain detects tools from
structural fingerprints, resolves conflicts through a deterministic
ladder, and captures configs as real files under the pattern's
toolchain/ directory; dependencies filters manifests through a curated
purpose registry so only transferable infrastructure choices become
facets; languages ranks sanctioned languages from linguist data,
records runtime version pins, and detects the docs language offline.

Everything below the evidence bar degrades into counted prose notes a
human can promote by hand, so a wrong facet is structurally impossible.
Extraction is a pure function of the working tree per ADR-0003, which
also records the consolidated format-1 schema changes. The design was
stress-tested by an adversarial panel before implementation; its
findings are documented in docs/design/extract.md. Verified end to end
against dolly itself and three real repositories. Full suite: 52 tests.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012iwLXzR5W8b5BY4WSfNY9T

### c8f6e26 (2026-07-24)

fix: read parameterized just recipes and stop counting assets as code

Two extraction polish items surfaced by running against a real service
repo. The task-target inventory only matched bare recipe names, so just
recipes taking parameters or listing dependencies were invisible; the
matcher now accepts anything between the name and the colon. And binary
assets like fonts and media were counted as unrecognized code-adjacent
bytes, which produced an alarming and wrong "93% unrecognized" note on
repos that ship fixtures; known asset extensions are now simply
invisible to the language share.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012iwLXzR5W8b5BY4WSfNY9T

### bc042ae (2026-07-25)

feat: scaffold fresh projects with dolly new, plus commands and license facets

dolly new expands a pattern's layout (module {name} templates instantiated
once, named after the project, with workspaces derived), writes captured
toolchain configs back to their source paths, folds embedded subtrees into
generated base manifests, stamps LICENSE from stored texts, seeds starter
files so the toolchain has inputs, and runs git init. The two facets it
consumes ship with extract support: commands (canonical verbs from the
resolved task runner's own file) and license (manifest fields with a
LICENSE-text fingerprint fallback), both degrading honestly per ADR-0003.

A five-dimension adversarial audit confirmed seven findings, all fixed here,
including an ISC fingerprint whose guard matched "DISCLAIMS" (0BSD could
stamp as ISC) and a NUL-byte path that crashed scaffolds mid-write.
Acceptance ran against the dolly repo itself: extract, scaffold, and the
fresh project passes biome check, tsc --noEmit, and bun test.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012iwLXzR5W8b5BY4WSfNY9T

### 1135a2e (2026-07-25)

feat: capture file templates from agreeing siblings and instantiate them

The scaffold facet completes M3. Templates come from the {name} groups the
layout scanner already voted into existence, on an agreement bar: every
member must carry the file, and the files must be byte-identical once each
member's own name becomes {{name}} and the package scope {{project}}, so a
template can never carry the source project's identity into an unrelated
one. One dissenting member is a counted note instead, which is what dolly's
own packages and ADRs correctly produce. Capture gates (size, text, machine
paths, and a refusal for files that already write {{ }}) now live in one
shared module with the toolchain's.

dolly new instantiates each template at its expanded path, ahead of the
generic stubs but behind captured configs. The {name} path semantics moved
into a single expandName helper shared by layout entries and templates.

Verified end to end: dolly's own repo extracts, scaffolds, and the fresh
project still passes biome check, tsc --noEmit, and bun test; a uniform
monorepo exercises the capture path through extract, new, and a .dolly
bundle round-trip.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012iwLXzR5W8b5BY4WSfNY9T

### e68f838 (2026-08-11)

fix: close eleven review findings across the path gate, license, commands, and scaffolder

Second-pass review of the M3 work, verified finding by finding against the
code. The path gate now matches .git case-insensitively and survives
Windows trailing-dot normalization; toolchain.configs values pass the full
gate too, so backslash traversal is refused. The license scanner treats a
GPL-family fingerprint as candidates a manifest can agree with (or not),
where disagreement kills the facet even when the text cannot pin one id, and an
unusable manifest declaration now silences a stray permissive LICENSE.
Commands sweep to a fixpoint so dropping one verb orphans its callers,
count direct yarn/pnpm script invocations as references, and scan recipe
bodies past blank lines. The identity gate reads Cargo.toml, pyproject and
go.mod so non-npm captures are gated too, dissent notes count the largest
agreeing group, a captured taskfile or LICENSE is never overwritten by
generated content, a file that is another file's parent yields to the
directory instead of crashing writeTree, and a bare {name} layout file is
per-resource, not an empty project-named stub.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### b554cce (2026-08-11)

feat: enforce patterns with dolly check, plus the testing facet and hook fingerprints

M4. A rule engine maps eight rules over the same shared inventory extract
uses: layout, naming, config binding, commands, license, testing, hooks,
and a built-in env-hygiene rule that leans on the walk itself, since the
inventory applies .gitignore, so a visible .env IS the violation. Each
violation carries at most one autofix and --fix only ever creates,
appends, or merges: renames stay fit's job, license text is never
replaced, a root manifest is never invented, and files whose comments a
rewrite would destroy degrade to reports. Fixing is idempotent: check
re-runs its rules after fixing and a second --fix changes nothing.

Three maintainer decisions shape it (docs/design/check.md): dolly new
writes a committed .dolly marker so check knows its pattern (an explicit
argument wins); captured configs bind as subsets by default — captured
keys present and equal, project extras welcome — with toolchain.binding
opting a config into verbatim bytes; and --watch is a plain debounced
full re-run that refuses to combine with --fix.

Two facets land with extract support: testing (placement + {stem} naming
shape, both by 80% vote) and toolchain.hooks (husky/lefthook/pre-commit).
Acceptance: a fresh scaffold passes its own pattern's check via the
marker alone, and seeded violations across five rules are found and fixed
idempotently. 114 tests green.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### 4728577 (2026-08-11)

fix: close the two M4 soft spots — presence binding and testing-aware seeds

Config binding gains a third mode, presence: the file must exist, its
contents are the project's own — the silencer for a team that
legitimately diverges from a capture. And the byte-equality fallback for
non-JSON/TOML captures is now report-only: the M4 build shipped it with
an overwrite fix, which contradicted check's own no-lost-work ground
rule the moment a team edited a captured .editorconfig. Only explicit
verbatim overwrites; a missing file keeps its create-fix in every mode,
since creation cannot lose work.

dolly new now consumes the testing facet when seeding starter tests,
split along ADR-0003's ownership line: the test runner owns the seed's
contents, the facet its name and placement. filePattern names the seed
(index.spec.ts instead of index.test.ts) and a colocated pattern seeds
next to the entry file rather than waiting for a test directory its
layout doesn't have. Before this, a spec-named or colocated pattern
scaffolded a seed that violated its own pattern's check.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### 9593dd5 (2026-08-11)

fix: close every verified finding from the whole-project architecture review

Nine bugs, each with a regression test. The sharpest was a data-loss
class in check --fix: three rules decided 'missing' from the inventory,
which deliberately cannot see gitignored or @generated files, then wrote
to disk unchecked — truncating a gitignored justfile, a generated source
file, a proprietary LICENSE. Absence is now a disk question and
visibility the inventory's (check.md ground rule 3): every create-fix
re-checks the disk, and a present-but-invisible file gets its own
report-only violation. Alongside it: a forced re-extract now replaces
the pattern directory wholesale so retired captures stop shipping in
bundles; an embedded capture no longer invents the root manifest it
belongs in; gitignored lockfiles stopped counting as package-manager
evidence (ADR-0003 clone-state invariance); CheckReport gained a
diagnostics channel so a broken pattern can never report as a clean
tree; bundle imports pass the same isSafePatternPath gate as every other
pattern input (which now also refuses ':' — drive letters and NTFS
alternate data streams alike); merge fixes are offered only when
reserialization reproduces the file byte-for-byte, so a one-key fix can
never come back as a whole-file reflow; throwing fixes and watch errors
are contained and reported; and the npm license object form, plus
regex-over-TOML version pins, are read properly.

The cheap consensus refactors rode along: the .dolly marker is a module
both its producer and consumer import, the license-file finder and the
prototype-chain ban list each have one home, ecosystemOfPattern replaced
three hand-rolled derivations, --watch moved into the engine as
watchProject so the CLI only prints (GUI parity by construction), the
public barrel shrank from ~63 leaked symbols to a curated surface the
future daemon can bind to, dolly check got CLI-level tests, and the
triplicated test fixtures collapsed into test/support.ts. The heavier
FixPlan/Rule + module-move refactor is recorded on the M6 milestone as
fit's first PR, per the review's sequencing; ADR-0003 records its one
standing purity exception (pattern identity from the directory basename).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### e9519f8 (2026-08-13)

feat: give dolly a face — the serve daemon and the web-first M5 GUI

dolly serve is the engine's one door: a verb of the CLI binding the core
barrel route by route (patterns list/read/edit/delete, check with fixes,
watch as an NDJSON stream), bound to 127.0.0.1 behind a per-run bearer
token carried in the URL fragment, with a Host check against DNS
rebinding. It serves the built webview at / on the same origin.

apps/desktop is the GUI it serves: Vue 3 + Vite, three views (library,
pattern viewer/editor with the validate-on-save loop, check dashboard
with fix and live watch), sheep palette in both color schemes. The Tauri
shell wraps this exact pair once the host has the Rust toolchain; the
install and wrap steps live in apps/desktop/README.md.

Acceptance ran visually: headless Chrome drove the real daemon serving
the real build through library → view → edit → check → fix → dark mode
with zero console errors, palettes pixel-verified. 140 tests green.

Design in docs/design/gui.md; maintainer decisions 2026-08-12: Vue 3,
web-first with the native wrap deferred to when the toolchain lands.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### c50100f (2026-08-13)

feat: the caliber pass — app shell, CodeMirror editor, Inter, geometric mark

The GUI graduates from webpage to product, per four maintainer-picked
upgrades. The top navbar becomes a sidebar app shell with iconed nav and
a daemon status line (version + live dot, warm when unreachable). The
textarea becomes CodeMirror 6 with YAML awareness, themed from the
palette's own CSS variables so one theme serves both schemes. A polish
pass adds toasts for save/delete/fix, loading skeletons, empty states,
focus rings, and a check summary strip over per-rule groups in tabular
numerals. Inter ships self-hosted, so typography stops depending on the
host OS.

The logo is redrawn geometric: the original one-line topology — fleece,
saddles, integrated head bumps, hairpin ears, outward eyes — regenerated
from mirrored math with a uniform chunkier stroke that stays legible at
16px where the original went wispy, plus assets/app-icon.svg as the
rounded-square tile for the native shell to come.

Re-verified visually end to end: headless Chrome drove library → view →
edit → check → fix → dark against the rebuilt bundle with zero console
errors; both palettes pixel-sampled to their exact tokens. 140 tests
green; bundle 139 KB gzipped, everything local, Tauri-safe.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### 25322e3 (2026-08-13)

fix: seat the ears on the crown of each head

The redraw had faithfully inherited the original's flaw: ears hung from
the fleece crease, across the face, reading as stuck-on loops. They are
now solid petal flaps seated on each head's exposed crown arc, and the
eyes settle below them on the face — parameter-swept and judged on
contact sheets from 430px down to 16.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### 0a3287f (2026-08-13)

feat: the native shell — a Tauri window around dolly serve

Closes M5. The config declares no windows: lib.rs spawns the daemon on
an ephemeral port, reads the tokened URL off its stdout, and only then
builds the webview window pointed at it — the window can only exist
once the engine's one door does. No engine bindings in Rust; closing
the window kills the daemon (verified by pid). Icons generated from
assets/app-icon.svg. Bundling a compiled daemon as a true sidecar and
directory pickers remain release work.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### e9e1c14 (2026-08-13)

fix: reshape the heads to the maintainer's sketch — ears hang from the top line

The cloud turns into each head with a straight top line that rounds at
the muzzle and returns symmetrically; the U-ear hangs from that line,
both ends on it, between the head's start and the outward-facing eye.
Replaces the petal ears, which sat on the crown — anatomically wrong
too. Synced into the webview, the app icon, and the Tauri icon set.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### 84c16d6 (2026-08-13)

refactor: fixes become data — FixPlan, one executor, rules behind one contract

The M6-opening refactor the architecture review mandated, part one.
Violation.fix is now a FixPlan (create/write/append/merge) interpreted
by the one executor in check/fix.ts — a CheckReport travels as JSON,
which is what fit's dry-run diff and the daemon build on. The eight
rules move behind the one Rule contract in check/rules/, mirroring
extract's scanner-per-file idiom; reporting order is the RULES array.
The taskfile recipe scanner is unified in taskfile.ts — extract and
check read recipes with the same eyes, and the writer lives beside it.

Behavior is byte-identical, with one deliberate tightening: a Makefile
recipe headed \`@name:\` no longer matches check's scan (make gives @ no
target-level meaning; the unified scanner keeps just's @-prefix only).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### ad67a39 (2026-08-13)

refactor: the shared helpers get named homes — tree/, serialize.ts, apply/content.ts

Part two of the M6-opening refactor. The inventory walk — shared by all
three verbs — moves out of extract/ into tree/; the by-extension
parse/serialize pair, deep-path access, and the prototype-chain ban move
into serialize.ts; the invented-file stubs move into apply/content.ts.
check no longer reaches into apply/new for anything — the scaffolder and
the rules now both stand on the same named modules.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### 1896d4c (2026-08-13)

test: the layout scanner's voting constants become falsifiable

Thirteen direct unit tests over a synthesized inventory, one lever each:
minGroup gates the vote itself (two siblings never open it), coreRatio's
6/10 bar, required = carried-by-all, the stoplist majority veto, the
workspace-declaration bypass, file-per-resource voting with the index
exclusion, maxDepth with single-child chain collapse, root-vocabulary
and .gitkeep requiredness, anchors, and the entry budget's
deepest-optional-first truncation.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### e0c8d0e (2026-08-13)

docs: record the M6-opening refactor — fixes-as-data, named modules, falsifiable voting

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### e53d46e (2026-08-13)

docs: design fit — dry-run planner, moves with import rewrites, checkpoint branch

One maintainer decision (2026-08-13) shapes v1: relative TS/JS imports
are rewritten where resolution is unambiguous; a move fit cannot account
for degrades to report-only. Fit plans in check's currency — FixPlans
adopted verbatim, plus the move/rewrite step kinds check refuses.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### 1b827da (2026-08-13)

feat: dolly fit — the migration planner lands

fitProject plans in check's currency: fixable violations ride along as
fix steps, and naming/testing violations become moves — each carrying
the relative TS/JS import rewrites that keep the tree compiling, in the
author's own specifier style. Every guard declines with its reason
rather than guessing. fitApply is the write path whole: clean-git
refusal, checkpoint branch, fixes → rewrites → moves, then a commit so
git switch back is the undo. The design doc's acceptance loop runs as a
test verbatim.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### f23d78c (2026-08-14)

feat: the GUI grows a fit view — the plan crosses the wire as itself

POST /api/fit serves fitProject/fitApply straight through (the FixPlan
refactor is why there is no view logic to write), plus the git state so
the UI can gate Apply; git preconditions come back as 409. The view
renders moves with their rewrites as subordinate lines, fixes with
their plan kind, and a left-to-you group with every declined reason;
Apply confirms, then reports its checkpoint branch. Check's naming and
testing messages now point at dolly fit instead of calling the moves
hand-work.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### bbdd623 (2026-08-14)

fix: the audit's defect class — license fingerprints, colliding creates, fit's blind spots

Three findings from the product-honesty audit (run against real clones:
hono, typer, petite-vue, p-limit), each with a regression test. The MIT
text fingerprints again despite title forms and line wraps — clause
checks run on whitespace-flattened text now. Creates aimed at one path
reconcile (contents beat stubs) and a held disk guard reports skipped,
never fixed. And fit enforces ground rule 4 both ways: moves of files
the import ledger cannot read decline with reasons, blind importer
types (.vue/.svelte/.astro/.mdx) decline every move, layout-demanded
test paths decline as pattern contradictions, and the ledger reads
.mts/.cts/.mjs/.cjs. fit.md states v1's scope plainly: a TS/JS
migration tool, honest declines elsewhere.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### 310400a (2026-08-14)

fix: the code review's eight — fit's guards now see what apply will do

All confirmed findings from the medium-effort review of apply/, each
with a regression test. Specifier rewrites apply in one pass (sequential
replaceAll could chain two rewrites into a wrong module). A half-applied
tree is never committed, and git's own exit codes decide what committed
means. Move targets are checked against the plan's own fix-created
paths, against the disk by inode (a case-only rename is the one
overwrite allowed; a gitignored file at the destination no longer gets
clobbered), and against directories the same plan renames away —
whether the move starts inside one or would land inside one. Renames
keep the affixes check never judged (my_thing_test stays a test).
Swap-mode rewrites reproduce the author's written extension instead of
deriving one from the target. And the separate-placement destination
walks to the nearest test root, matching placementOf, so monorepos get
packages/api/tests, not a stray top-level one. Rode along: the dead
first buildMapping call, new.ts's hooks-era gitInit docstring, and its
hardcoded test-root list (now TEST_ROOT_NAMES, gaining spec/).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### 79cf566 (2026-08-14)

feat: naming is about code — the vote and the rule scope to the languages facet

The audit's largest noise source, maintainer-approved: with a languages
facet in hand, only its extensions vote in extract's naming pools and
only they are judged by check's naming rule — a PascalCase .png or an
off-style doc is neither dissent nor a violation. Directories follow
the same line: only those holding code (at any depth) participate. An
explicit naming.extensions entry stays the author's opt-in for
anything else, enforced as before. Without a languages facet, behavior
is unchanged. This also removes most of fit's gray-zone moves at the
source — the .cff renames and doc-image moves the audit flagged can no
longer even be proposed.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### 1f4cd61 (2026-08-14)

feat: merges are minimal edits — tabs, comments, and the author's shape survive

The audit's second guard, maintainer-approved: for JSON and JSONC the
byte-identity refusal in canRewrite is gone — merges now apply through
jsonc-parser's modify/applyEdits as per-key text edits that leave
comments, indentation style, and key order standing, with missing
parents created and already-equal keys producing no edit at all. The
p-limit case (tab-indented manifest, every script merge permanently
declined) now fixes with tab-indented insertions. TOML keeps the
conservative bar until an equivalent editor exists.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### 88622be (2026-08-14)

feat: the hooks facet earns its keep, and scaffolds wear the pattern's case

The audit's last approved pair. File-based hook managers (lefthook,
pre-commit) capture their config like any other toolchain config, so
new writes the file back, check's config rule gets a real create-fix,
and the hooks rule stands down where the capture owns the answer —
husky stays fingerprint-only, being a directory of scripts. And a
scaffolded {name} instance renders through the pattern's own naming
facet per position (directories style for segments, files style for
stems), so a snake_case pattern scaffolded as from-typer yields
from_typer and passes its own check.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### 91a1c90 (2026-08-14)

docs: record the review's eight and the audit's three approved changes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### e348a21 (2026-08-14)

style: every word reworded, and the writing rule made standing

Nothing in dolly may read like AI text, by maintainer rule, and dash
punctuation goes first. Around five hundred spots reworded across docs,
code comments, CLI and GUI copy, and generated output; report lines now
read path: message, and test assertions moved with the messages they
quote. Two em dashes remain, both in fixtures imitating third-party
bytes, which are not dolly's words.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### 48d4649 (2026-08-14)

feat: M7 opens with dolly ai, the BYOK foundation

One provider interface, three plain fetch adapters (Anthropic, OpenAI,
Google), keys from the environment or the OS keychain through the
platform's own tool, and the ai.json switch consumers read as a client
or null. connect verifies a key with a live round trip before storing
it; off means absent, so no deterministic path imports the layer.
Design in docs/design/ai.md.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### 60bbdd2 (2026-08-14)

feat: semantic placement, the AI layer's first consumer

Fit's ambiguous declines enumerate the destinations the planner refused
to pick between; assistedFit asks the model to choose among exactly
those, and the pick rides the declined item as a labeled suggestion the
CLI and fit view print. A reply outside the candidates is discarded,
and apply never reads suggestions, so a wrong pick costs a shrug.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EeoHCSeg3Jv7iQ7dFix4ey

### 3f927b5 (2026-08-22)

feat: the mark becomes one solid silhouette

The two-headed sheep stays, drawn now as five scallops over a rounded
base with the heads as the ends of the body facing outward and the eyes
knocked out in the background colour, so it is one ink in both schemes
and reads from a 16px favicon to the store tile. The app icon keeps its
rounded tile, and the Tauri icon set is regenerated from it.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SDNuq6jKoDSfue8WvcD3s2

### f61ffa2 (2026-08-22)

feat: learning mode, the AI layer's second consumer

dolly learn watches a project and turns what changes into pattern edits
the user reviews as a diff, one proposal at a time. The watcher
re-extracts the project whenever it settles and compares facet by facet
with the pattern it is linked to; every disagreement is a proposal as
data, with its path in segments because facet keys carry dots, the value
the project reads as, what the pattern holds, a reason, and the captured
bytes when a toolchain config drifted. Proposals only add or replace and
lists only grow, so nothing is ever taken away. The model enters once per
session, at review time and only with the layer on, to draft up to five
convention lines from the files that changed; only bullet lines survive.
Accepted proposals are written together through dolly's own serializer
with the prose kept. --once skips the watch, --yes accepts everything,
and a non-interactive stdin prints and writes nothing.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SDNuq6jKoDSfue8WvcD3s2

### 9afd735 (2026-08-22)

feat: design steps join the plan, and the daemon learns

Visual work is a standing step now: every surface is designed on a
canvas and approved there before it is ported, and each milestone
names its design steps. The learn view went through it first, two
boards on the app canvas's Learn page, and waits for approval. The
daemon side landed meanwhile: GET /api/learn streams proposals and the
changed files per re-learn, POST /api/learn writes the accepted set
and refuses a captured path that leaves the pattern directory, and
POST /api/learn/draft is the session's one model call. The watch
exposes its changed list as it grows, which the stream reads.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SDNuq6jKoDSfue8WvcD3s2

### d93792b (2026-08-22)

feat: the learn view, ported from the approved board

A fifth route and a Learn item in the nav and the palette. The view
holds the daemon's learn stream open and lists every proposal as a
panel: its path, its reason, the diff it would make, and an accept or
skip pair. Decisions are kept by proposal identity, so a re-learn that
replaces the facet proposals keeps what the user decided; the model's
convention drafts arrive on Stop watching and stay until written or
skipped. Write sends the accepted set and drops what was written. The
stream names the pattern it resolved and carries each proposal's
rendered diff, a JSON view concern the daemon keeps off the engine, and
check's NDJSON reader became the shared streamLines both watches use.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SDNuq6jKoDSfue8WvcD3s2

### 588cff8 (2026-08-22)

docs: the AI settings surface goes on the canvas

Two boards on the app canvas's Settings page, reached from the
sidebar's AI line and mirroring dolly ai verb for verb: status per
provider with where its key lives, Use, Connect with a key verified
live before the keychain stores it, an optional model, and the switch.
Awaiting approval before its port.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SDNuq6jKoDSfue8WvcD3s2

### 35616ea (2026-08-22)

feat: the AI settings surface, ported from the approved board

Reached from the sidebar's AI line and mirroring dolly ai verb for
verb: every provider with its default model and where its key lives,
Use for the active one, Connect with the key verified live before the
keychain stores it (a refusal shows in the provider's words and keeps
the form), the model field, and the switch. aiProviders() joins the
engine's barrel; the daemon gains GET /api/ai/providers and POST
/api/ai/{connect,use,off}, a provider's refusal mapped to a 400. The
sidebar line and the view share one status, fetched on demand.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SDNuq6jKoDSfue8WvcD3s2

### 72a64b3 (2026-08-22)

docs: translation designed, and ADR-0004 records the decision

Full translation behind apply: the languages check rule and fit's
planner decide which files, to which language, at which paths; the
model fills in each file's bytes under --apply only; the pattern's own
typecheck and test commands judge the result before any source file is
removed or anything is committed. The ADR carves the one exception to
fit's no-deletion rule and fixes the bounds.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SDNuq6jKoDSfue8WvcD3s2

### d083e5f (2026-08-22)

feat: cross-language translation, engine first

The languages check rule reports every code file whose language sits
outside the pattern's list, never fixable. Fit gains a translate step,
planned only with the AI layer on and within ADR-0004's bounds, declined
with the connect hint otherwise. Under apply the model fills in each
file, one call and one fenced block per file, and the pattern's own
typecheck and test commands judge the result before any source is
removed or anything is committed. The CLI prints what would go to the
model; the daemon applies through the same door.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SDNuq6jKoDSfue8WvcD3s2

### efc7369 (2026-08-22)

test: a quote the stub's reply can carry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SDNuq6jKoDSfue8WvcD3s2

### bf993ac (2026-08-22)

feat: M7 closes, with translation in the fit view

The fit view renders translate steps with their target language and
what would go to the model, and the verdict of the pattern's typecheck
and test commands after an apply. The live check caught a planning gap:
two sources with one stem both targeted the same file, so translations
now carry the collision guard moves have. fit.md, the README, and the
CHANGELOG describe translation.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SDNuq6jKoDSfue8WvcD3s2

### 75577bc (2026-08-22)

refactor: the project-wide review, forty-one findings applied

Five finders by area and a skeptic that refuted six; the forty-one that
survived are all in. Behavior: the dependencies facet shares toolchain's
primary ecosystem, the editorconfig and hook-manager captures pass the
same gates as every other capture, the config rule treats a gitignored
config as invisible, translation's output budget follows the source's
size, saveLearned refuses an escaping path before writing, the fit view
clears a stale checkpoint on a fresh plan, and the settings view takes
each provider's environment variable from the engine. Tidying: one home
for the file helpers, recipe names, deepEqual, AI usage errors, the
remembered directory, the actions row, and the font stacks; the literal
NUL bytes in dependencies.ts are escapes. Docs caught up in nine places,
CI builds the webview, and four tests joined.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SDNuq6jKoDSfue8WvcD3s2

### 429054d (2026-08-23)

feat: M8 opens, exports and the history facets

The design doc and ADR-0005 first: commits and releases.versioning are
the two facets allowed to read history, bounded and silent without a
repository, and the only fields a clone and its tarball can differ in.
The commits scanner votes style, types, scopes and subject case from
the last 200 subjects; releases reads the tag shape, the changelog's
style and the release tool. A releases check rule creates a missing
Keep a Changelog file and reports a missing tool config; new stamps the
header. The exporters live beside the bundle in export/: one brief in
four frames (Claude skill, Cursor rule, AGENTS.md, system prompt), each
at the path its consumer expects, behind dolly export --as, --out - to
print, and --force to overwrite. The daemon previews and saves the text
targets; the pattern view shows the two facets. Seventeen tests joined.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SDNuq6jKoDSfue8WvcD3s2

### 1eb8881 (2026-08-23)

docs: the export view designed on the canvas

Two boards on a new Export page: the view after a save, with the
target list and the rendered file beside the shared project fields,
and the view when the file already exists. Export joins the nav on
every board. gui.md and PLAN record it; the port waits for approval.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SDNuq6jKoDSfue8WvcD3s2

### 5e55c3c (2026-08-23)

feat: M8 closes, with the export view ported

The approved board, in code: the export view behind #/export, the
target list beside the rendered file, Save into project with the
conflict callout over a 409, Copy, Export in the nav and the palette,
and an Export button on the pattern view. The daemon's export routes
resolve the pattern from the marker like every project route and the
preview carries the resolved name. The live check caught a regression
from the review pass: the remembered project directory was restored
during the parent's render and swallowed by the scheduler, so the
check, fit, and learn inputs showed blank; it restores on mount.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SDNuq6jKoDSfue8WvcD3s2

### 74a1684 (2026-08-23)

feat: M9 opens with the shell's pickers and the flows they unlock

The daemon gains extract, new, and import, and the bundle target of
export takes a save dialog's path; a name or directory already taken is
a 409. The shell gains the dialog plugin, granted to the daemon's origin
through the capability file, and lib/native.ts is the one seam, dialogs
only. From the approved Flows boards: PathField with its Browse button,
Extract a project and Import a bundle as inline panels on the library
(Replace or Keep mine over a 409, the arrival opened when it lands),
New project on the pattern view with the report and its next steps,
and Save a bundle on the export view inside the shell. facetNames()
gives the CLI and the daemon one listing of a pattern's facets.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SDNuq6jKoDSfue8WvcD3s2


