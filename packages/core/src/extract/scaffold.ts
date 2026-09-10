import { join } from "node:path";
import type { Scaffold } from "../pattern/schema";
import { comparePaths, type Inventory } from "../tree/inventory";
import { hasMachinePath, identityMarker, isBinary, wholeWord } from "./capture";
import type { ProjectIdentity } from "./identity";
import type { TemplateGroup } from "./layout";

/**
 * Captures file templates from the sibling groups the layout scanner already
 * generalized. The evidence is agreement: when every member of a `{name}`
 * group carries the same file and those files are byte-identical once each
 * member's own name is replaced by `{{name}}`, that shape is a convention and
 * becomes a template. One dissenting member means the file is content, not
 * convention: a counted note, never a template.
 */
export const SCAFFOLD_TUNING = {
  /** Templates above this size are noted, never captured. */
  maxCaptureBytes: 64 * 1024,
};

export interface ScaffoldScan {
  scaffold?: Scaffold;
  /** Pattern-relative path → contents, written next to pattern.md. */
  files: Record<string, string>;
  notes: string[];
}

export async function scanScaffold(
  inventory: Inventory,
  groups: TemplateGroup[],
  { scope, name: identity }: ProjectIdentity,
): Promise<ScaffoldScan> {
  const notes: string[] = [];
  const files: Record<string, string> = {};
  const templates: string[] = [];

  for (const group of [...groups].sort((a, b) => comparePaths(a.target, b.target))) {
    if (group.members.length < 2) continue;
    const normalized: string[] = [];
    // The path is part of the file too: a docs page named after the project stays home.
    let blocked = pathMarker(group.target, identity);

    for (const member of group.members) {
      if (blocked) break;
      const file = Bun.file(join(inventory.root, member.path));
      if (file.size > SCAFFOLD_TUNING.maxCaptureBytes) {
        blocked = `over ${SCAFFOLD_TUNING.maxCaptureBytes / 1024} KiB`;
        break;
      }
      const contents = await file.text();
      if (isBinary(contents)) {
        blocked = "not text";
        break;
      }
      if (hasMachinePath(contents)) {
        blocked = "references machine-specific paths";
        break;
      }
      // dolly's own placeholder must be unambiguous on instantiation, so a
      // file that already writes {{…}} (Vue, Handlebars, Jinja) is left alone.
      if (contents.includes("{{")) {
        blocked = "already contains {{ }} placeholders";
        break;
      }
      const text = placeholderize(contents, member.name, scope);
      const marker = identityMarker(text, identity);
      if (marker) {
        blocked = `carries ${marker}`;
        break;
      }
      normalized.push(text);
    }

    if (blocked) {
      notes.push(`${group.target} not captured as a template: ${blocked}.`);
      continue;
    }
    const [first, ...rest] = normalized as [string, ...string[]];
    if (rest.every((text) => text === first)) {
      templates.push(group.target);
      files[`templates/${group.target}`] = first;
    } else {
      const counts = new Map<string, number>();
      for (const text of normalized) counts.set(text, (counts.get(text) ?? 0) + 1);
      const agree = Math.max(...counts.values());
      notes.push(
        `${group.target} differs across ${group.members.length} siblings (largest agreeing group: ${agree}), so it is file contents, not a template.`,
      );
    }
  }

  return {
    scaffold: templates.length > 0 ? { templates } : undefined,
    files,
    notes,
  };
}

/**
 * Replaces the member's own name with `{{name}}`, but only as a whole word, so
 * capturing the `cli` member never rewrites the word "client". The package
 * scope goes too (`@mono/api` → `@{{project}}/{{name}}`). Only the scope form
 * is rewritten: a bare project token like "test" appears in ordinary code, and
 * mangling it would be worse than leaving it, so whatever identity survives
 * this rewrite is caught by `identityMarker` and blocks the capture instead.
 */
function placeholderize(contents: string, name: string, scope: string | undefined): string {
  const withName = contents.replace(wholeWord(name), "{{name}}");
  return scope ? withName.replace(wholeWord(`@${scope}`), "@{{project}}") : withName;
}

/** The identity gate's verdict on a template's own path, in the note's words. */
function pathMarker(target: string, identity: string | undefined): string | undefined {
  const marker = identityMarker(target, identity);
  return marker ? `${marker} in its path` : undefined;
}
