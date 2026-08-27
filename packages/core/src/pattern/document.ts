import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { type Pattern, patternSchema } from "./schema";

/**
 * A pattern on disk is a Markdown document: YAML frontmatter holds the facets
 * the deterministic engine understands, and the Markdown body holds the
 * conventions only humans (and, later, the AI layer) can interpret.
 */
export interface PatternDocument {
  pattern: Pattern;
  /** Free-form Markdown describing conventions the engine doesn't model. */
  prose: string;
}

const FENCE = "---";

export class PatternParseError extends Error {
  override name = "PatternParseError";
}

export function parsePatternDocument(source: string): PatternDocument {
  const lines = source.split("\n");
  if (lines[0]?.trim() !== FENCE) {
    throw new PatternParseError(
      `A pattern file must start with a "${FENCE}" YAML frontmatter block.`,
    );
  }
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === FENCE);
  if (closing === -1) {
    throw new PatternParseError(`The "${FENCE}" frontmatter block is never closed.`);
  }

  let facets: unknown;
  try {
    facets = parseYaml(lines.slice(1, closing).join("\n"));
  } catch (cause) {
    throw new PatternParseError(`Frontmatter is not valid YAML: ${(cause as Error).message}`);
  }

  const parsed = patternSchema.safeParse(facets);
  if (!parsed.success) {
    throw new PatternParseError(`Invalid pattern facets:\n${z.prettifyError(parsed.error)}`);
  }

  const prose = lines
    .slice(closing + 1)
    .join("\n")
    .trim();
  return { pattern: parsed.data, prose };
}

export function serializePatternDocument(doc: PatternDocument): string {
  const frontmatter = stringifyYaml(withoutEmptyDefaults(doc.pattern)).trimEnd();
  const body = doc.prose.trim();
  return `${FENCE}\n${frontmatter}\n${FENCE}\n${body ? `\n${body}\n` : ""}`;
}

/**
 * Empty records and arrays are schema defaults that parsing restores, so
 * writing them out (`extensions: {}`, `layout: []`) is only YAML noise for
 * the human editor. Parse ∘ serialize still round-trips.
 */
function withoutEmptyDefaults(pattern: Pattern): Pattern {
  const pruned = structuredClone(pattern) as Record<string, unknown>;
  const prune = (value: unknown): void => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      const emptyArray = Array.isArray(child) && child.length === 0;
      const emptyRecord =
        typeof child === "object" &&
        child !== null &&
        !Array.isArray(child) &&
        Object.keys(child).length === 0;
      if (emptyArray || emptyRecord) delete record[key];
      else prune(child);
    }
  };
  prune(pruned);
  return pruned as unknown as Pattern;
}
