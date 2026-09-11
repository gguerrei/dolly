# The AI layer (M7)

The design behind `dolly ai` and everything that will sit on it. M7 adds the one thing the deterministic engine cannot do: judgment. Semantic file placement, cross-language translation, and the passive learning mode all need a model. This document covers the foundation those features share, which is what lands first: provider adapters, key handling, and the switch that turns the whole layer on and off.

The governing pillar is PLAN's fourth: AI is optional, never required. Everything deterministic works with AI off, and the AI layer is strictly additive. That pillar turns into three ground rules here.

## Ground rules

1. **Off is the default, and off means absent.** No consumer of the engine ever needs the AI layer to exist. The deterministic verbs never import it. A consumer that wants AI asks `activeAi()` and gets `null` when the layer is off, which is also what it gets when nothing was ever configured. There is no degraded mode, no retry, no nagging: null means proceed deterministically.
2. **Keys live in the OS keychain or the environment, nowhere else.** Never in config files, never in patterns, never in bundles or exports, never in logs or error messages. The settings file records which provider is active and which model, and nothing more. This is the risk table's "API keys leaking" row made mechanical.
3. **AI suggests, the deterministic engine decides.** Whatever a consumer does with a completion, the output is labeled as the model's and never applied to disk without the same guards the deterministic path uses. A wrong suggestion must cost the user a shrug, not a file.

## The provider interface

One interface, three implementations, all plain `fetch`:

```ts
interface AiRequest {
  system?: string;
  prompt: string;
  maxTokens?: number;
}
// complete(request, key, model) => the model's text
```

No provider SDKs. Each adapter is one POST to one endpoint with one response shape to unwrap; three SDK dependency trees would buy nothing and would weigh on the `bun build --compile` future the risk table already worries about. A non-2xx response becomes an `AiProviderError` carrying the provider's own message with the key redacted, so a revoked key or a retired model says what happened in the provider's words.

The request shape is deliberately small. Consumers ask for text and parse it themselves; structured output modes differ per provider and can be added when a consumer actually needs one.

| Provider | Endpoint | Auth | Default model | Key env var |
|---|---|---|---|---|
| `anthropic` | `POST /v1/messages` | `x-api-key` | `claude-sonnet-5` | `ANTHROPIC_API_KEY` |
| `openai` | `POST /v1/chat/completions` | `Bearer` | `gpt-5.1` | `OPENAI_API_KEY` |
| `google` | `POST /v1beta/models/{model}:generateContent` | `x-goog-api-key` | `gemini-2.5-flash` | `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) |

Defaults live in this one table (mirrored in `ai/providers.ts`) and `dolly ai use --model` overrides per machine. A stale default is not a silent failure: `connect` verifies with a live call, so a retired model id surfaces immediately, in the provider's own error text. Current models reason before they answer, and those tokens count against `maxTokens`, so every consumer's budget holds the reasoning and the reply both; a budget sized for the reply alone comes back empty or cut short.

## Keys

Lookup order, per provider:

1. **The environment.** `ANTHROPIC_API_KEY` and friends are the BYOK convention every provider documents; if the variable is set, dolly uses it and stores nothing.
2. **The OS keychain**, written by `dolly ai connect`. dolly speaks to the keychain through the platform's own tool rather than a native module (the stack decision to prefer pure TS holds; a compiled binary must not drag a node-gyp dependency for one secret):
   - macOS: `security` against the login keychain (service `dolly`, account = provider). The write goes through `security -i` with the command on stdin, so the key never appears in an argv another process could list.
   - Linux: `secret-tool` (libsecret) with `service dolly account <provider>`; the secret rides stdin by the tool's own design.
   - Windows: `connect` refuses for now, with the env var spelled out as the way in. `cmdkey` cannot read secrets back and the DPAPI route needs a real Windows machine to verify; that machine arrives with M9's CI matrix, and the keychain path is owed then.

A missing keychain tool is an honest refusal naming the env var alternative, never a fallback to a plaintext file. Removing a stored key is the OS tool's job (`secret-tool clear service dolly account anthropic`, or Keychain Access on macOS); `connect` overwrites in place.

## The switch

Active provider and model live in `<dollyHome>/ai.json`, beside the pattern store: `{"provider": "anthropic", "model": "..."}` with `model` optional. The file is the switch. `dolly ai use` writes it, `dolly ai off` deletes it, and `activeAi()` reads it fresh on every call, resolves the key, and hands back a ready client or `null`. No process state, so the daemon and CLI agree by construction.

`use` refuses when no key can be found for the provider, naming both ways to supply one. A selection without a key would make every consumer limp with a warning; better to fail at the moment of choice, where the fix is one command away.

## The CLI verb

```
dolly ai                       # status: provider, model, where the key comes from
dolly ai --verify              # the same, plus one live call: the provider's verdict on the key, exit 1 on a refusal
dolly ai connect <provider>    # prompt for the key (no echo), verify live, store in the keychain
dolly ai use <provider> [--model <id>]
dolly ai off                   # forget the selection; keys stay put
```

`connect` verifies before it stores: one tiny completion round trip, so a mistyped key fails at connect time with the provider's error, not three weeks later in the middle of a fit. When no provider is active yet, a successful connect also selects the one just connected, because that is what the user meant. The key is read from a no-echo prompt, or from stdin when piped, and never accepted as a flag: argv is visible to every process on the machine and lands in shell history.

## Semantic placement (v1)

The first consumer, picked by the maintainer (2026-08-14). Fit's planner already enumerates the destinations an ambiguous decline could take (several same-stem sources for a colocated test, several test roots for a separate one) and refuses to guess between them; those candidates now ride the declined item as data. `assistedFit` wraps `fitProject`: with AI off it returns the plan untouched and calls nothing, and with AI on it asks the model to choose among the planner's own candidates, showing it the pattern's prose and relevant facets, the decline's reason, and the file's opening bytes. The reply's first line must match a candidate verbatim or the whole answer is discarded; the model chooses, it never invents a path. A valid pick rides the declined item as a `suggestion` carrying the one-line why and the model's name, and the CLI and the fit view print it labeled as the model's. Apply reads plans, not suggestions, so a wrong pick costs the user a shrug (ground rule 3 made mechanical). One plan asks for at most ten placements, and any provider failure leaves the plan exactly as the planner made it, with the failure on the declined item (`aiError`, printed by the CLI and shown in the fit view), so a revoked key shows in the plan instead of a silent shrug.

## Learning mode (v1)

The second consumer, shaped by three maintainer decisions (2026-08-21): it is a live watcher, not an on-demand scan; it reads evidence from the filesystem as edits happen; and a draft is a diff the user accepts change by change. `dolly learn` watches the project the way `check --watch` does and, each time the tree settles, re-extracts it with the same scanners `extract` uses and compares the result with the pattern the project is linked to. Every disagreement is a *proposal*: one dotted facet path, the value the project now reads as, the value the pattern holds, and a one-line reason. Proposals are data (`learn/drift.ts`), and the deterministic half of learning needs no model at all: a naming style that flipped, a runtime pin that moved, a new command verb, a purpose-keyed dependency the pattern never met, a layout entry the project now carries, a captured config whose bytes drifted (that proposal carries the new bytes and writes them on accept). Layout entries are only ever added, never removed, an instance of a `{name}` entry the pattern already lists is not drift, and scaffold templates are left alone; a pattern losing something is check's conversation, not learn's.

The model enters once, at review time, and only when the layer is on. The watcher remembers which files changed during the session; when the user stops watching, `draftConventions` shows the model the pattern's prose, the facet proposals, and the opening bytes of up to twelve changed files, and asks for at most five convention lines, each a single sentence a linter could not enforce. Lines come back as bullets and become prose proposals appended under the pattern's conventions; anything that is not a bullet is discarded, and a provider failure is reported in the provider's words while the deterministic proposals stand. One call per session keeps the cost flat no matter how long the watch ran.

Review is per proposal: the CLI renders each one as the unified diff it would make to `pattern.md` and asks to accept, skip, or quit; accepted proposals are applied together at the end and the document is written through dolly's own serializer, prose verbatim. Nothing touches the pattern until the user says so (ground rule 3 again), and `--once` skips the watch for a single pass (and so drafts nothing: no file changed under its watch), `--yes` accepts every proposal without asking, and a non-interactive stdin without `--yes` prints the proposals and writes nothing. Learn is for the project a pattern was extracted from, or the one its author treats as canonical: where check asks "does the project follow the pattern", learn asks "should the pattern follow the project", and the user holds the answer to both.

## Cross-language translation (v1)

The third consumer, scoped by the maintainer on 2026-08-22 as full translation behind apply and designed in [docs/design/translation.md](translation.md) with its own [ADR-0004](../adr/0004-translation-behind-apply.md). It is the one consumer where the model produces content the deterministic engine cannot, so ground rule 3 is restated for it rather than broken: the `languages` check rule and fit's planner decide which files, to which language, at which paths; the model fills in the bytes of each file under `--apply` only; and the pattern's own `typecheck` and `test` commands judge the result before a single source file is removed or anything is committed. With the layer off, translate steps are declined with the connect hint.

## The conventions check (v1)

The fourth consumer (2026-09-10). The deterministic rules judge the facets;
the prose conventions ("raise domain errors, translate to HTTP at the router
layer") were only ever exported, never checked. `dolly check --conventions`
(and the check view's Conventions toggle, `conventions: true` on `POST
/api/check`) asks the model to read them: `assistedCheck` in `ai/check.ts`
wraps `checkProject`, so the deterministic path never imports the layer, and
with the layer off the flag refuses with the connect hint.

One call per check. The prompt carries the pattern's prose and the code
files changed against HEAD (untracked included; every code file when there
is no git to ask), each in full, under three bounds that are part of the
contract: at most 25 files, 64 KiB per file, and 200 KiB in all, with every
file left out named in the report's `skipped` list and its reason. The reply
is one line per finding, `path:line: message`, and a line naming a file that
was not sent is not a finding. What comes back rides the report as
`conventions` (the model, the findings, the skipped files): its own section
in the CLI and the GUI, labeled as the model's reading, never counted toward
the exit code, and never fixed. `--watch` refuses the flag, since a watcher
would call the model on every save.

## Testing

Adapters run against a stubbed `fetch`: each provider's request shape (URL, auth header, body) is asserted outbound and its response shape unwrapped inbound, plus the error path with the provider's message surfaced and the key absent from it. Key handling runs against a fake `secret-tool` on `PATH` in a temp dir, covering store, lookup, env precedence, and the missing-tool refusal. The switch is exercised end to end under a temp `DOLLY_HOME`: use without a key refuses, use with an env key writes the file, off deletes it, `activeAi()` returns null exactly when the file is gone. The CLI walk covers status output in both states. No test ever talks to a real provider; `connect`'s live verification is covered by pointing the adapter at the stub. Placement runs against a real ambiguous fixture: off means fitProject's plan verbatim with zero calls, on attaches the labeled pick, a pick outside the candidates is discarded, and a provider failure changes nothing. Translation runs against a small Python project under a TypeScript pattern: the dry run lists translate steps with their byte count, AI off declines them, a stubbed well-formed reply is written, verified by the pattern's commands, committed, and leaves check clean, and a malformed reply or a failing verification commits nothing and keeps every original. Learning runs against a real extracted fixture that is then edited: drift yields exactly the proposals the edits warrant (and none when the project matches its pattern), applying them round-trips through the serializer with prose kept, a drifted config capture writes its new bytes, the conventions call sends the changed files and keeps only bullet lines, and the CLI walk covers `--once --yes` writing and a non-interactive `--once` writing nothing.
