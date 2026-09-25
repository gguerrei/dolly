# @dollysheep/core

The engine behind [dolly](https://github.com/gguerrei/dolly): the pattern
model, extraction, scaffolding, checking, fitting, learning and the
exports, as a library. The `dolly` command and its GUI are built on
exactly this surface, so an editor extension or a build step can do what
they do without going through either.

```sh
bun add @dollysheep/core       # the engine runs on bun >= 1.2
```

```ts
import { checkProject, extractPattern, PatternStore, saveExtractedPattern } from "@dollysheep/core";

const store = new PatternStore(); // the machine's store, or new PatternStore(dir)
await saveExtractedPattern(store, await extractPattern("./a-project", "my-style"));
const report = await checkProject(store, "my-style", "./another-project");
console.log(report.violations.length === 0 ? "clean" : report.violations);
```

Everything exported from the package's entry point is the public API, one
function per verb, typed and documented at the declaration. What is not
exported is internal and free to move; the `dolly` command's own help
says what each verb does.

MIT licensed; the notices for what the package bundles are in
`THIRD_PARTY_LICENSES.md` beside this file.
