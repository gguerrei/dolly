/**
 * Cross-language translation: the AI layer's third consumer, and the one
 * where the model produces content the engine cannot, the one exception
 * the layer's rules carve, behind apply. The planner decides which files, to which
 * language, at which paths; this module fills in the bytes of each file
 * under apply, one call per file, the whole file back or the step fails.
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type FitApplyResult, fitApply, type TranslateStep, type Translator } from "../apply/fit";
import type { PatternDocument } from "../pattern/document";
import type { PatternStore } from "../store";
import { type AiClient, activeAi } from "./ai";

/** Already translated files shown as house style, at most this many and this long each. */
const MAX_EXAMPLES = 3;
const EXAMPLE_BYTES = 3000;

/**
 * fitApply with the model behind every translate step when the layer is
 * on. With it off, translate steps are declined at planning time and
 * nothing here is reached; the plan applies exactly as fitApply would.
 */
export async function assistedFitApply(
  store: PatternStore,
  patternName: string,
  projectDir: string,
): Promise<FitApplyResult> {
  const client = await activeAi();
  if (!client) return fitApply(store, patternName, projectDir);
  const doc = await store.load(patternName);
  const root = resolve(projectDir);
  return fitApply(store, patternName, root, {
    translate: true,
    translator: translatorFor(client, doc, root),
  });
}

function translatorFor(client: AiClient, doc: PatternDocument, root: string): Translator {
  return async (step, plan, done) => {
    const source = await readFile(join(root, step.from), "utf8");
    const mapping = plan.steps
      .filter((s): s is TranslateStep => s.kind === "translate")
      .map((s) => `- ${s.from} becomes ${s.to}`);
    const examples = await Promise.all(
      done.slice(-MAX_EXAMPLES).map(async (s) => {
        const text = await readFile(join(root, s.to), "utf8").catch(() => "");
        return `--- ${s.to}\n${text.slice(0, EXAMPLE_BYTES)}`;
      }),
    );
    const reply = await client.complete({
      system:
        "You are dolly's translator. dolly saves how a project is organized as a pattern, " +
        `and this pattern is written in ${step.language}; the project has a file in another ` +
        `language. Rewrite that file in ${step.language}, preserving its behavior, its exports ` +
        "and their names, and its comments, following the pattern's conventions below. Other " +
        "files in the same plan are being translated too, at the paths listed, so import them " +
        "at their new paths. Answer with exactly one fenced code block containing the whole " +
        "translated file and nothing else: no prose before or after.",
      prompt: [
        `Pattern "${doc.pattern.name}": ${doc.pattern.description}`,
        "",
        "The pattern's prose conventions:",
        doc.prose.trim() || "(none written)",
        "",
        "Relevant facets:",
        JSON.stringify(
          {
            languages: doc.pattern.languages,
            naming: doc.pattern.naming,
            testing: doc.pattern.testing,
            dependencies: doc.pattern.dependencies,
          },
          null,
          2,
        ),
        "",
        "Every translation in this plan:",
        ...mapping,
        "",
        ...(examples.length
          ? ["Files already translated in this plan, as the house style:", ...examples, ""]
          : []),
        `Translate ${step.from} into ${step.to}:`,
        "",
        source,
      ].join("\n"),
      // Room for the whole file back, after whatever reasoning the model spends first:
      // a translation runs about the source's length, and the budget holds both.
      maxTokens: Math.min(32_000, 8_000 + step.bytes),
    });
    return wholeFile(reply);
  };
}

/** The one fenced block, or a failure: a partial file is worse than none. */
function wholeFile(reply: string): string {
  const match = reply.match(/```[\w.+-]*\n([\s\S]*?)\n?```/);
  if (!match) throw new Error("the model did not answer with one fenced code block");
  const body = (match[1] ?? "").trimEnd();
  if (!body.trim()) throw new Error("the model answered with an empty file");
  return `${body}\n`;
}
