# ADR 0005: The history facets, and the exception they carve

- Status: accepted
- Date: 2026-08-22

## Context

[ADR-0003](0003-deterministic-extraction.md) made extraction a pure
function of the working tree: no git history, so that a tarball and a
clone extract identically and `.git` presence can never change output. It
named the cost up front: "any future facet that needs history (e.g.
commit-message grammar) requires its own ADR carving an explicit,
documented exception."

M8's exports are files for coding agents, and the conventions those files
are judged on include two the tree cannot tell: how commit messages are
written, and how versions are cut. A pattern that cannot say "Conventional
Commits, scopes optional" leaves the agent to guess at the one thing it
writes on every change. The evidence exists, in the repository's history
and tags, and it is as deterministic as the tree once the sample is
bounded.

## Decision

1. **Two facets may read history: `commits` and `releases.versioning`.**
   `commits` votes from the last 200 non-merge commits reachable from
   `HEAD`; `releases.versioning` votes from the tag list. No other facet
   may, now or later, without amending this ADR. The rest of `releases`
   (`changelog`, `tool`) is tree evidence and falls under ADR-0003 as it
   stands.
2. **The exception is bounded and silent.** The sample is capped, the
   thresholds are rules in one exported tuning const like every scanner's,
   and the facets are absent (never guessed) when there is no repository,
   no `git` on the PATH, or too little history. A shallow clone votes on
   what it has. Whatever the state, the two history facets are the only
   fields that can differ between a clone and its tarball; ADR-0003's
   "testable byte-for-byte" now holds modulo identity and modulo these two.
3. **Check stays tree-only.** A commit is not a path, and check's contract
   is violations with paths and fixes as data. The `releases` rule
   enforces the file-shaped parts (the changelog's presence, the release
   tool's fingerprint); message grammar is enforced by the hook manager
   and commitlint config a pattern may capture, and read by the exports.
4. **Exports are a pure function of the pattern document.** A target
   renders `pattern.md` and nothing else: not the store, not the keychain,
   not the project it lands in. This is what makes "keys never enter
   exports" a structural fact rather than a filter.

## Consequences

- `dolly learn` will propose `commits` and `releases` edits as history
  grows, through the same drift path as every facet; a project that
  adopts scopes on every commit will see `scope: optional` proposed as
  `required` once the vote flips.
- The same project extracted before and after a tag cannot be assumed
  byte-identical; the extract fixtures pin both the git and the tarball
  outcome so the difference is tested, not discovered.
- Exports carry the pattern's prose verbatim, extraction notes included.
  The author who wants a cleaner `AGENTS.md` edits the pattern, which is
  the right place: one source, every target follows.
