/**
 * Convention drafting: the AI layer's second consumer, and learning mode's
 * one model call. Shown the pattern, the facet drift the engine already
 * found, and the files that changed during a learn session, the model
 * drafts a few convention lines a linter could not enforce. They come back
 * as prose proposals for the user to accept or skip, never as pattern text.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { classifyCode } from "../extract/languages";
import { type Proposal, pathLabel } from "../learn/drift";
import type { PatternDocument } from "../pattern/document";
import { collectInventory } from "../tree/inventory";
import { type AiClient, activeAi } from "./ai";

/** At most this many convention lines per session, from at most this many changed files. */
const MAX_LINES = 5;
const MAX_FILES = 12;
const EXCERPT_BYTES = 1500;

/**
 * Prose proposals drafted from a learn session, or none: with the layer off
 * or with nothing changed, learning stays deterministic and this returns an
 * empty list without a call. A provider failure is the provider's error, in
 * its words, for the caller to show; the deterministic proposals stand.
 */
export async function draftConventions(
  doc: PatternDocument,
  root: string,
  changedFiles: string[],
  drift: Proposal[],
): Promise<Proposal[]> {
  if (changedFiles.length === 0) return [];
  const client = await activeAi();
  if (!client) return [];
  return draft(client, doc, root, changedFiles, drift);
}

async function draft(
  client: AiClient,
  doc: PatternDocument,
  root: string,
  changedFiles: string[],
  drift: Proposal[],
): Promise<Proposal[]> {
  // Only code the inventory can see: never a .env, a credential, or a path outside the project.
  const code = new Set((await classifyCode(await collectInventory(root))).files.map((f) => f.path));
  const shown = changedFiles.filter((file) => code.has(file)).slice(0, MAX_FILES);
  if (shown.length === 0) return [];
  const excerpts = await Promise.all(
    shown.map(async (file) => `--- ${file}\n${await excerptOf(join(root, file))}`),
  );
  const reply = await client.complete({
    system:
      "You are dolly's learning assistant. dolly saves how a project is organized as a " +
      "pattern: facets a linter enforces, and prose conventions only people can judge. " +
      "The user edited a project while dolly watched; the facet changes are already " +
      "found. Your job is the other kind: conventions the edits reveal that no facet " +
      "captures (how errors flow, what a module may import, how things are named " +
      "beyond case, where a kind of logic belongs). Answer with up to " +
      `${MAX_LINES} lines, each starting with "- " and stating one convention as a plain ` +
      "sentence. Skip anything the facets already say, anything already in the prose, " +
      "and anything you cannot see evidence for. If there is nothing worth writing, " +
      "answer with nothing.",
    prompt: [
      `Pattern "${doc.pattern.name}": ${doc.pattern.description}`,
      "",
      "The pattern's prose conventions today:",
      doc.prose.trim() || "(none written)",
      "",
      "Facet changes the engine already found:",
      drift.length ? drift.map((p) => `- ${pathLabel(p.path)}: ${p.reason}`).join("\n") : "(none)",
      "",
      `Code files changed during the session (${shown.length}):`,
      ...excerpts,
    ].join("\n"),
    // Five short lines, after whatever reasoning the model spends first; the budget holds both.
    maxTokens: 4000,
  });
  return reply
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+\S/.test(line)) // only bullets count; prose around them is discarded
    .slice(0, MAX_LINES)
    .map((line) => ({
      path: ["prose"],
      value: line.replace(/^[-*]\s+/, "").slice(0, 300),
      reason: `drafted by ${client.model} from the files that changed`,
    }));
}

async function excerptOf(path: string): Promise<string> {
  try {
    return (await readFile(path, "utf8")).slice(0, EXCERPT_BYTES);
  } catch {
    return "(unreadable, or deleted)";
  }
}
