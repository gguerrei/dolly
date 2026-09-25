# Security Policy

dolly is at its first release. Security fixes land on `main` and ship in
the next version; there are no other supported lines.

## Reporting a vulnerability

Please report vulnerabilities privately by email to **guirguerreiro@gmail.com**.
Include what you found, how to reproduce it, and any impact you can assess.

- You will receive an acknowledgment within roughly 7 days.
- Please do **not** open public issues for security vulnerabilities; give us a
  chance to fix the problem before it is disclosed.

## What dolly trusts, and what it never does

dolly is a local tool that reads trees other people wrote and applies
patterns other people made. These are the lines it holds, so a report can
say which one moved.

- **A symlink is never followed.** Not in a repository dolly extracts from,
  checks, fits or learns from, not in a pattern vendored into a checkout,
  and not in a bundle it packs. A committed link that points outside the
  tree is skipped by every read and refuses every write, so a stranger's
  repository cannot make `check --fix`, `fit --apply` or `learn` touch a
  file outside the project, and cannot make `extract` carry a file from
  elsewhere on the machine into a pattern.
- **A pattern from elsewhere can make dolly run exactly two things, and
  both are shown first.** Its `typecheck` and `test` commands judge a
  translation under `fit --apply`; the dry run prints them as written, and
  `dolly import` names them the moment the pattern arrives. `dolly new`
  writes the pattern's commands into the scaffold's manifest, never under a
  name npm runs on install. Nothing runs on import, on check, or on plan.
- **`check --fix` never overwrites.** It creates, appends and merges; the
  one whole-file write, the `verbatim` binding, is fit's, behind fit's
  dirty-tree refusal, checkpoint branch and dry-run diff.
- **A pattern travels without credentials.** Extract refuses a `.env`, an
  `.npmrc`, a key file or anything that looks like a secret as a template
  or a captured config, and says so in the notes. The AI layer sends the
  model only code files the inventory can see, under fixed bounds, and
  keys live in the OS keychain or the environment, never in a file dolly
  writes and never on a command line.
- **git runs with the repository's own config disarmed.** A tree delivered
  with its `.git` directory cannot name a signature verifier, a filesystem
  monitor or a hooks directory that dolly would then execute.
- **The daemon is loopback and a token.** `dolly serve` listens on
  127.0.0.1, every `/api` route needs the bearer token the printed URL
  carries in its fragment, a foreign Host header is refused, the webview
  is served with a content security policy and never framed, and a
  malformed request is a 404, not a stack trace.
- **A release can be checked.** Every GitHub release carries `SHA256SUMS`
  for its binaries, the Homebrew formula pins the same hashes, the
  workflows run pinned action commits with least privilege, and the npm
  token reaches only the step that publishes, after a maintainer has
  published the release on GitHub.

Thank you for helping keep dolly and its users safe.
