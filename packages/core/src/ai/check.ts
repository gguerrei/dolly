/**
 * The conventions check: the AI layer's fourth consumer. The deterministic
 * rules judge the facets; the prose conventions only a reader can judge, so
 * under `--conventions` one model call reads them against the code files
 * that changed and reports what it sees in its own section of the report,
 * labeled as its reading and never counted. With the
 * layer off the flag refuses; without it, nothing here is reached.
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type CheckReport, type ConventionsReport, checkProject } from "../check/check";
import { classifyCode } from "../extract/languages";
import type { PatternDocument } from "../pattern/document";
import type { PatternStore } from "../store";
import { runGit } from "../tree/git";
import { collectInventory } from "../tree/inventory";
import { type AiClient, AiUsageError, activeAi } from "./ai";

/** What one check may send to the model: files, bytes each, and bytes in all. */
export const CONVENTIONS_BOUNDS = {
  maxFiles: 25,
  maxFileBytes: 64 * 1024,
  maxTotalBytes: 200 * 1024,
};

export interface AssistedCheckOptions {
  fix?: boolean;
  /** Ask the model to read the prose conventions against the changed code files. */
  conventions?: boolean;
}

/** checkProject, plus the model's reading of the conventions when asked and the layer is on. */
export async function assistedCheck(
  store: PatternStore,
  patternName: string,
  projectDir: string,
  options: AssistedCheckOptions = {},
): Promise<CheckReport> {
  const report = await checkProject(store, patternName, projectDir, { fix: options.fix });
  if (!options.conventions) return report;
  const client = await activeAi();
  if (!client) {
    throw new AiUsageError("--conventions needs the AI layer; `dolly ai connect` turns it on.");
  }
  const doc = await store.load(patternName);
  return { ...report, conventions: await judgeConventions(client, doc, resolve(projectDir)) };
}

async function judgeConventions(
  client: AiClient,
  doc: PatternDocument,
  root: string,
): Promise<ConventionsReport> {
  const { maxFiles, maxFileBytes, maxTotalBytes } = CONVENTIONS_BOUNDS;
  const skipped: string[] = [];
  const excerpts: { path: string; text: string }[] = [];
  let total = 0;
  for (const path of await changedCodeFiles(root)) {
    if (excerpts.length >= maxFiles) {
      skipped.push(`${path}: over the ${maxFiles} files one check reads`);
      continue;
    }
    const text = await readFile(join(root, path), "utf8").catch(() => null);
    if (text === null) {
      skipped.push(`${path}: unreadable`);
      continue;
    }
    const bytes = Buffer.byteLength(text);
    if (bytes > maxFileBytes) {
      skipped.push(
        `${path}: ${Math.round(bytes / 1024)} KiB is over the ${maxFileBytes / 1024} KiB one file may be`,
      );
      continue;
    }
    if (total + bytes > maxTotalBytes) {
      skipped.push(`${path}: over the ${maxTotalBytes / 1024} KiB one check reads in all`);
      continue;
    }
    total += bytes;
    excerpts.push({ path, text });
  }
  if (excerpts.length === 0) return { model: client.model, findings: [], skipped };

  const reply = await client.complete({
    system:
      "You are dolly's conventions reviewer. dolly saves how a project is organized as a " +
      "pattern: facets a linter enforces, and prose conventions only a reader can judge. The " +
      "facets were already checked by the deterministic rules; your job is the prose. Read the " +
      "conventions, then the files, and report each place a file breaks a convention as one " +
      "line: the path exactly as given, a colon, the line number when you can point at one, a " +
      "colon, and one short sentence naming the convention and what breaks it. Report nothing " +
      "the conventions do not say, nothing about the facets, and nothing you cannot see. If " +
      "nothing breaks a convention, answer with the single word nothing.",
    prompt: [
      `Pattern "${doc.pattern.name}": ${doc.pattern.description}`,
      "",
      "The conventions:",
      doc.prose.trim() || "(none written)",
      "",
      `The files (${excerpts.length}):`,
      ...excerpts.map(({ path, text }) => `--- ${path}\n${text}`),
    ].join("\n"),
    // A few lines back, after whatever reasoning the model spends first; the budget holds both.
    maxTokens: 6000,
  });
  const sent = new Set(excerpts.map((e) => e.path));
  const findings = reply.split("\n").flatMap((raw) => {
    const line = raw.trim().replace(/^[-*]\s+/, "");
    const match = line.match(/^(\S+?)(?::(\d+))?:\s+(.+)$/);
    // A finding names a file that was sent, or it is not a finding.
    if (!match || !sent.has(match[1] as string)) return [];
    return [
      {
        path: match[1] as string,
        ...(match[2] ? { line: Number(match[2]) } : {}),
        message: (match[3] as string).slice(0, 300),
      },
    ];
  });
  return { model: client.model, findings, skipped };
}

/**
 * The code files worth the model's time: the ones changed against HEAD,
 * untracked included, or every code file when there is no git to ask.
 */
async function changedCodeFiles(root: string): Promise<string[]> {
  const inventory = await collectInventory(root);
  const code = new Set((await classifyCode(inventory)).files.map((f) => f.path));
  const changed = await runGit(root, "diff", "--name-only", "--relative", "HEAD");
  if (!changed.ok) return [...code].sort();
  const untracked = await runGit(root, "ls-files", "--others", "--exclude-standard");
  const listed = `${changed.out}\n${untracked.ok ? untracked.out : ""}`
    .split("\n")
    .map((line) => line.trim())
    .filter((path) => path !== "" && code.has(path));
  return [...new Set(listed)].sort();
}
