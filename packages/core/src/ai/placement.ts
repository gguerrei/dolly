/**
 * Semantic placement: the AI layer's first consumer. The deterministic
 * planner enumerates every destination an ambiguous decline could take and
 * refuses to guess between them; with AI on, the model picks one and says
 * why, and the pick rides the declined item as a labeled suggestion. It
 * never becomes a step: apply reads plans, not suggestions (ground rule 3
 * in docs/design/ai.md), so a wrong pick costs a shrug, not a file.
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type DeclinedItem, type FitPlan, fitProject } from "../apply/fit";
import type { PatternDocument } from "../pattern/document";
import type { PatternStore } from "../store";
import { type AiClient, activeAi } from "./ai";

/** Cost stays bounded: one plan asks for at most this many placements. */
const MAX_SUGGESTIONS = 10;
const EXCERPT_BYTES = 4000;

/**
 * fitProject with the AI layer's two planning-time contributions when it
 * is on: translate steps planned rather than declined (ADR-0004), and a
 * labeled suggestion on each ambiguous decline. With it off (or on any
 * failure) the plan comes back exactly as fitProject makes it; the layer
 * is additive or absent.
 */
export async function assistedFit(
  store: PatternStore,
  patternName: string,
  projectDir: string,
): Promise<FitPlan> {
  const client = await activeAi();
  const plan = await fitProject(store, patternName, projectDir, { translate: client !== null });
  const ambiguous = plan.declined.filter((item) => (item.candidates?.length ?? 0) > 1);
  if (!client || ambiguous.length === 0) return plan;
  const doc = await store.load(patternName);
  for (const item of ambiguous.slice(0, MAX_SUGGESTIONS)) {
    try {
      const suggestion = await suggest(client, doc, resolve(projectDir), item);
      if (suggestion) item.suggestion = suggestion;
    } catch (error) {
      // A failed suggestion never fails the plan, but it says why it is missing.
      item.aiError = `${client.model} could not suggest: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return plan;
}

async function suggest(
  client: AiClient,
  doc: PatternDocument,
  root: string,
  item: DeclinedItem,
): Promise<{ pick: string; why: string; model: string } | null> {
  const candidates = item.candidates ?? [];
  const reply = await client.complete({
    system:
      "You are dolly's placement assistant. dolly's deterministic planner declined a file " +
      "move because more than one destination is equally valid by mechanical rules; yours " +
      "is the judgment call. Read the pattern and the file, then answer with exactly two " +
      "lines: the chosen destination copied verbatim from the candidate list, and one " +
      "short sentence saying why.",
    prompt: [
      `Pattern "${doc.pattern.name}": ${doc.pattern.description}`,
      "",
      "The pattern's prose conventions:",
      doc.prose.trim() || "(none written)",
      "",
      "Relevant facets:",
      JSON.stringify(
        { testing: doc.pattern.testing, layout: doc.pattern.layout, naming: doc.pattern.naming },
        null,
        2,
      ),
      "",
      `Declined file: ${item.path}`,
      `Reason: ${item.message}`,
      "",
      "Candidate destinations:",
      ...candidates.map((candidate) => `- ${candidate}`),
      "",
      "The file's opening bytes:",
      await excerptOf(join(root, item.path)),
    ].join("\n"),
    // One line and its why, after whatever reasoning the model spends first; the budget holds both.
    maxTokens: 2000,
  });
  const lines = reply
    .split("\n")
    .map(strip)
    .filter((line) => line !== "");
  const pick = lines[0];
  // The pick must be one of the planner's own candidates, verbatim.
  // Anything else is not a suggestion, whatever the model meant by it.
  if (!pick || !candidates.includes(pick)) return null;
  return { pick, why: (lines[1] ?? "").slice(0, 200), model: client.model };
}

/** Models decorate; the parser undoes bullets, backticks, and quotes. */
function strip(line: string): string {
  return line
    .trim()
    .replace(/^[-*]\s+/, "")
    .replace(/^[`"']+|[`"']+$/g, "");
}

async function excerptOf(path: string): Promise<string> {
  try {
    return (await readFile(path, "utf8")).slice(0, EXCERPT_BYTES);
  } catch {
    return "(unreadable)";
  }
}
