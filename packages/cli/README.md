# dollysheep

`dolly` saves the way you build software as a pattern, then applies it
anywhere: extract a pattern from a project you like, scaffold new projects
from it, check and fit existing ones against it, and export it for coding
agents. Everything runs on your machine; an AI layer is optional and
bring-your-own-key.

```sh
bun add -g dollysheep          # needs bun >= 1.2
dolly extract . --name my-style
dolly new my-style ../lamb
dolly check -C ../lamb
dolly serve --open             # the GUI, served locally
```

The project, its docs, and its source live at
https://github.com/gguerrei/dolly. MIT licensed; the notices for what the
package bundles are in `THIRD_PARTY_LICENSES.md` beside this file.
