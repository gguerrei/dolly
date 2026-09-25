# dollysheep

`dolly` saves the way you build software as a pattern, then applies it
anywhere: extract a pattern from a project you like, scaffold new projects
from it, check and fit existing ones against it, learn from a project as it
changes, and export the pattern for coding agents and editors. Everything
runs on your machine; the AI layer is optional and bring your own key.

```sh
bun add -g dollysheep          # needs bun >= 1.2 (npm install -g works too; the command still runs on bun)
dolly extract . --name my-style
dolly new my-style ../lamb
dolly check -C ../lamb
dolly serve --open             # the GUI, served locally, embedded in the package
dolly --help                   # every verb
```

The same command ships as a single binary per platform and as a desktop
app on the project's release page, and on macOS through Homebrew
(`brew install gguerrei/dolly/dolly`). The engine alone is
`@dollysheep/core`.

The source lives at https://github.com/gguerrei/dolly, with `SECURITY.md`
saying what dolly trusts and never does. MIT licensed; the notices for what
the package bundles are in `THIRD_PARTY_LICENSES.md` beside this file.
