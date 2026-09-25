import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { PatternDocument } from "../pattern/document";
import type { PatternStore } from "../store";
import { renderBrief } from "./brief";
import { exportBundle } from "./bundle";

/**
 * `dolly export`: a pattern rendered for the tools that read conventions
 * but never read pattern.md. Every text target is the one brief in a frame
 * ; the bundle is the M1 zip, kept as the default
 * so the verb reads as it always did.
 */
export const EXPORT_TARGETS = [
  "bundle",
  "claude-skill",
  "claude-md",
  "cursor",
  "agents-md",
  "copilot",
  "gemini",
  "windsurf",
  "cline",
  "prompt",
] as const;
export type ExportTarget = (typeof EXPORT_TARGETS)[number];
export type TextTarget = Exclude<ExportTarget, "bundle">;

export interface RenderedExport {
  target: TextTarget;
  /** Where the consumer expects the file, relative to the project root. */
  path: string;
  contents: string;
}

export class ExportExistsError extends Error {
  override name = "ExportExistsError";

  constructor(path: string) {
    super(`${path} already exists; pass --force to replace it.`);
  }
}

/** The rendered file for a text target: a pure function of the document. */
export function renderExport(doc: PatternDocument, target: TextTarget): RenderedExport {
  const { name } = doc.pattern;
  const description = doc.pattern.description || `How ${name} projects are organized.`;
  const heading = `# ${name}\n\n${description}`;
  const brief = renderBrief(doc);
  // No folding: a skill or rule parser may read frontmatter line by line.
  const frontmatter = (fields: Record<string, unknown>) =>
    `---\n${stringifyYaml(fields, { lineWidth: 0 }).trimEnd()}\n---`;
  const file = (path: string, ...parts: string[]) => ({
    target,
    path,
    contents: `${parts.join("\n\n").trimEnd()}\n`,
  });
  // The plain files agents read at a fixed path share one frame: the heading, where the file came from, the brief.
  const exported = `Exported by dolly from the \`${name}\` pattern; edit the pattern (\`dolly edit ${name}\`) and export again rather than editing here.`;
  switch (target) {
    case "claude-skill":
      return file(
        `.claude/skills/${name}/SKILL.md`,
        frontmatter({
          name,
          description: `${description} Use when creating or changing files in a project that follows the ${name} pattern.`,
        }),
        heading,
        brief,
      );
    case "claude-md":
      return file("CLAUDE.md", heading, exported, brief);
    case "cursor":
      return file(
        `.cursor/rules/${name}.mdc`,
        frontmatter({ description, alwaysApply: true }),
        heading,
        brief,
      );
    case "agents-md":
      return file("AGENTS.md", heading, exported, brief);
    case "copilot":
      return file(".github/copilot-instructions.md", heading, exported, brief);
    case "gemini":
      return file("GEMINI.md", heading, exported, brief);
    case "windsurf":
      return file(
        `.windsurf/rules/${name}.md`,
        frontmatter({ trigger: "always_on", description }),
        heading,
        brief,
      );
    case "cline":
      return file(`.clinerules/${name}.md`, heading, exported, brief);
    case "prompt":
      return file(
        `${name}.prompt.md`,
        `You are working in a project organized by the "${name}" pattern: ${description} Follow these conventions exactly.`,
        brief,
      );
  }
}

/**
 * Writes the export and returns its absolute path. The default path is the
 * target's, resolved against the working directory; an existing file is
 * refused unless `force`, since an AGENTS.md is usually hand-written.
 */
export async function exportPattern(
  store: PatternStore,
  name: string,
  target: ExportTarget,
  options: { out?: string; force?: boolean } = {},
): Promise<string> {
  if (target === "bundle") {
    const out = resolve(options.out ?? `${name}.dolly`);
    await refuseExisting(out, options.force);
    return exportBundle(store, name, out);
  }
  const rendered = renderExport(await store.load(name), target);
  const out = resolve(options.out ?? rendered.path);
  await refuseExisting(out, options.force);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, rendered.contents);
  return out;
}

async function refuseExisting(path: string, force?: boolean): Promise<void> {
  if (!force && (await Bun.file(path).exists())) throw new ExportExistsError(path);
}
