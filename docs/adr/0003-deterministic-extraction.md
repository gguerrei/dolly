# ADR 0003: The deterministic extraction contract

- Status: accepted
- Date: 2026-07-24

## Context

`dolly extract` is the heart of the product: it infers a pattern from one real
repository with no annotations. An adversarial design review (five scanner
designs, four gap analyses, three critics) found that the biggest risks were
not in any single scanner but at the seams: scanners walking the tree
differently would build one pattern on inconsistent evidence, history-derived
facts would make the same tree extract differently across clone states, and
uncoordinated schema growth would make `format: 1` meaningless.

## Decision

1. **Extraction is a pure function of the working tree.** Output depends only
   on file bytes and the dolly version: never on git history, clock, network,
   locale, or filesystem enumeration order. dolly walks the tree itself
   (`.gitignore` semantics via the `ignore` package) instead of shelling out to
   `git ls-files`, so tarballs and clones extract identically and `.git`
   presence can never change output. Any future facet that needs history
   (e.g. commit-message grammar) requires its own ADR carving an explicit,
   documented exception. One standing exception, recorded 2026-08-11: the
   pattern's own identity (its default `name` and the description derived
   from it) comes from the source directory's basename, so byte-identical
   trees under different directory names differ in exactly those two fields
   and nothing else. "Testable byte-for-byte" holds modulo identity.

2. **One shared inventory.** A single walk module (one deny list, one
   vendored-dir policy, one generated-code filter, symlinks skipped,
   NFC-normalized POSIX paths in one deterministic sort) feeds every scanner.
   No scanner enumerates files privately.

3. **Confidence is rules, not scores.** Patterns never store confidence
   numbers. Each scanner defines evidence classes and thresholds in one
   exported tuning const; a finding either clears the bar (facet), was a
   candidate but fell short (counted prose note the user can promote by hand),
   or is incidental (silence). Curated data (the toolchain matrix, the
   dependency-purpose registry, the language table) fails toward prose:
   staleness costs coverage, never correctness.

4. **Tool identity has one owner.** The toolchain facet owns which formatter /
   linter / test runner a pattern prescribes; the dependencies registry defers
   to it for tool purposes. Two facets never assert the same fact.

5. **`format: 1` is fluid until the first public release (M9).** Pre-public,
   schema changes land as consolidated, reviewed diffs without a format bump;
   this ADR is the record old local patterns get. Bump discipline (a new
   format literal plus migration notes) starts the moment patterns can
   circulate publicly.

## Consequences

- Extract is testable byte-for-byte: fixtures in, exact pattern.md out.
- Untracked-but-unignored files count as evidence; that is the price of
  clone-state invariance, and the ignore/deny lists absorb the common cases.
- Captured tool configs live as real files under the pattern's `toolchain/`
  directory (bundles already carry whole directories), keeping frontmatter
  sleek and configs diffable.
- The M2 schema diff (naming.extensions, languages restructure + versions,
  toolchain roles + configs-as-files, layout path refinement) ships under
  format 1, per rule 5.

## Amendment (2026-09-10): the bump discipline

Rule 5 ends with the first public release. From v0.1.0 on, `PATTERN_FORMAT`
in `packages/core/src/pattern/schema.ts` is the one number every pattern
carries, and it moves only when a change would make an older dolly misread a
pattern (a renamed facet, a changed meaning), never for an addition an older
dolly can ignore. A bump lands with a migration in `pattern/document.ts` that
reads the previous format and writes the current one, and with a note in the
changelog. A pattern from a newer dolly is refused with the upgrade hint,
never misread; a pattern from an older one is migrated on read.
