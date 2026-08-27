#!/usr/bin/env bun
/**
 * Regenerates src/extract/languages-data.json from the linguist-languages
 * package (a devDependency), so linguist updates become reviewable diffs and
 * the runtime carries plain data instead of a dependency.
 *
 *   bun packages/core/scripts/generate-languages.ts
 */
import * as linguist from "linguist-languages";

interface Entry {
  name: string;
  type: string;
  extensions?: string[];
  filenames?: string[];
  interpreters?: string[];
}

const entries: Entry[] = Object.values(linguist as Record<string, Entry>)
  .filter((lang) => ["programming", "markup", "data", "prose"].includes(lang.type))
  .map(({ name, type, extensions, filenames, interpreters }) => ({
    name,
    type,
    ...(extensions?.length ? { extensions } : {}),
    ...(filenames?.length ? { filenames } : {}),
    ...(interpreters?.length ? { interpreters } : {}),
  }))
  .sort((a, b) => (a.name < b.name ? -1 : 1));

const out = new URL("../src/extract/languages-data.json", import.meta.url);
await Bun.write(out, `${JSON.stringify(entries, null, 1)}\n`);
console.log(`Wrote ${entries.length} languages to ${out.pathname}`);
