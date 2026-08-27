#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import {
  type AiStatus,
  aiOff,
  aiStatus,
  assistedFit,
  assistedFitApply,
  type CheckReport,
  checkProject,
  connectAi,
  dollyHome,
  draftConventions,
  EXPORT_TARGETS,
  exportPattern,
  extractPattern,
  type FitPlan,
  facetNames,
  gitStateOf,
  importBundle,
  learnDrift,
  type PatternDocument,
  PatternExistsError,
  PatternNotFoundError,
  PatternStore,
  PROVIDERS,
  type Proposal,
  pathLabel,
  readPatternMarker,
  renderExport,
  renderProposal,
  saveExtractedPattern,
  saveLearned,
  scaffoldProject,
  serializePatternDocument,
  useAi,
  watchLearning,
  watchProject,
} from "@dolly/core";
import { Command } from "commander";
import pkg from "../package.json";
import { DEFAULT_PORT, serveDolly } from "./serve";

const program = new Command("dolly")
  .description("Save your project's organization patterns. Apply them anywhere.")
  .version(pkg.version);

program
  .command("extract")
  .argument("[path]", "project to learn from", ".")
  .option("-n, --name <name>", "name for the new pattern (default: the directory name)")
  .option("-f, --force", "replace an existing pattern with the same name")
  .description("Infer a pattern from a real project. No annotations needed.")
  .action(async (path: string, options: { name?: string; force?: boolean }) => {
    const store = new PatternStore();
    const result = await extractPattern(path, options.name);
    const { pattern } = result.document;
    if ((await store.has(pattern.name)) && !options.force) {
      throw new PatternExistsError(pattern.name);
    }
    await saveExtractedPattern(store, result);

    const facets = facetNames(pattern).join(", ");
    const captured = Object.keys(result.files).length;
    console.log(
      `Saved pattern "${pattern.name}" (facets: ${facets || "none"}${captured ? `; ${captured} config${captured === 1 ? "" : "s"} captured` : ""}).`,
    );
    console.log(
      `Review it with \`dolly show ${pattern.name}\`. Extraction notes list what fell short of a facet.`,
    );
  });

program
  .command("new")
  .argument("<pattern>", "pattern to scaffold from")
  .argument("[dir]", "directory to create (default: the pattern name)")
  .description("Scaffold a fresh project from a pattern.")
  .action(async (pattern: string, dir: string | undefined) => {
    const report = await scaffoldProject(new PatternStore(), pattern, dir ?? pattern);
    console.log(
      `Scaffolded "${pattern}" into ${dir ?? pattern}/ (${report.created.length} entries).`,
    );
    if (report.skipped.length > 0) {
      console.log(
        `Skipped per-resource paths (their {name} names a module you add later): ${report.skipped.join(", ")}.`,
      );
    }
    for (const note of report.notes) console.log(`Note: ${note}`);
    console.log("\nNext steps:");
    for (const step of report.nextSteps) console.log(`  ${step}`);
  });

program
  .command("check")
  .argument("[pattern]", "pattern to check against (default: the project's .dolly marker)")
  .option("-C, --dir <dir>", "project directory to check", ".")
  .option("--fix", "apply safe autofixes (create, append, merge, never delete)")
  .option("--watch", "re-run whenever the project changes")
  .description("Check a project against its pattern.")
  .action(
    async (
      patternArg: string | undefined,
      options: { dir: string; fix?: boolean; watch?: boolean },
    ) => {
      if (options.fix && options.watch) {
        throw new Error(
          "--watch and --fix do not combine: a watcher that edits the tree it watches is a feedback loop.",
        );
      }
      const store = new PatternStore();
      const name = patternArg ?? (await readPatternMarker(options.dir));
      if (!name) {
        throw new Error(
          "No pattern named and no .dolly marker here. Run `dolly check <pattern>` (dolly new writes the marker for you).",
        );
      }
      if (!options.watch) {
        const report = await checkProject(store, name, options.dir, { fix: options.fix });
        printCheckReport(name, report);
        if (report.violations.length > 0) process.exitCode = 1;
        return;
      }
      // The engine owns the watch loop; the CLI only prints what it reports.
      let first = true;
      watchProject(
        store,
        name,
        options.dir,
        (report) => {
          if (!first) console.log("");
          printCheckReport(name, report);
          if (first) {
            console.log("\nWatching for changes (ctrl-c to stop).");
            first = false;
          }
        },
        (error) => {
          console.error(error instanceof Error ? error.message : String(error));
        },
      );
      await new Promise(() => {}); // watch runs until interrupted
    },
  );

program
  .command("fit")
  .argument("[pattern]", "pattern to fit to (default: the project's .dolly marker)")
  .option("-C, --dir <dir>", "project directory to fit", ".")
  .option("--apply", "execute the plan (requires a clean git tree; records a checkpoint branch)")
  .description(
    "Plan (and with --apply, perform) the moves and fixes that fit a project to its pattern.",
  )
  .action(async (patternArg: string | undefined, options: { dir: string; apply?: boolean }) => {
    const store = new PatternStore();
    const name = patternArg ?? (await readPatternMarker(options.dir));
    if (!name) {
      throw new Error(
        "No pattern named and no .dolly marker here. Run `dolly fit <pattern>` (dolly new writes the marker for you).",
      );
    }
    if (!options.apply) {
      // With AI on, ambiguous declines carry a labeled suggestion; the
      // plan itself is fitProject's either way, and apply never reads them.
      const plan = await assistedFit(store, name, options.dir);
      printFitPlan(name, plan);
      if (plan.steps.length > 0) {
        const git = await gitStateOf(options.dir);
        if (git === "missing") {
          console.log(
            "\n`dolly fit --apply` needs a git repository because the checkpoint branch is the undo.",
          );
        } else if (git === "dirty") {
          console.log("\nThe git tree is not clean. Commit or stash before `dolly fit --apply`.");
        } else {
          console.log("\nRun `dolly fit --apply` to perform this plan.");
        }
      }
      return;
    }
    // With AI on, translate steps are planned and the model fills them in (ADR-0004).
    const result = await assistedFitApply(store, name, options.dir);
    printFitPlan(name, result.plan);
    console.log(`\nCheckpoint: branch ${result.checkpoint} holds the tree as it was.`);
    for (const line of result.applied) console.log(`applied  ${line}`);
    for (const line of result.verified) console.log(`verified ${line}`);
    for (const line of result.failures) console.log(`FAILED   ${line}`);
    if (result.failures.length > 0) process.exitCode = 1;
    if (result.committed) {
      console.log(`Committed on the current branch. \`git switch ${result.checkpoint}\` reverts.`);
    }
  });

program
  .command("learn")
  .argument("[pattern]", "pattern to teach (default: the project's .dolly marker)")
  .option("-C, --dir <dir>", "project directory to learn from", ".")
  .option("--once", "learn from the project as it is now, without watching")
  .option("--yes", "accept every proposal without asking")
  .description("Watch a project and turn what changes into pattern edits you review.")
  .action(
    async (
      patternArg: string | undefined,
      options: { dir: string; once?: boolean; yes?: boolean },
    ) => {
      const store = new PatternStore();
      const name = patternArg ?? (await readPatternMarker(options.dir));
      if (!name) {
        throw new Error(
          "No pattern named and no .dolly marker here. Run `dolly learn <pattern>` (dolly new writes the marker for you).",
        );
      }
      if (!(await store.has(name))) throw new PatternNotFoundError(name);
      const { proposals, changed } = options.once
        ? { proposals: await learnDrift(store, name, options.dir), changed: [] }
        : await watchUntilStopped(store, name, options.dir);
      // The one model call of a session, and only with the layer on.
      const doc = await store.load(name);
      proposals.push(...(await draftConventions(doc, options.dir, changed, proposals)));
      if (proposals.length === 0) {
        console.log(`Nothing to learn: the project already matches "${name}".`);
        return;
      }
      const accepted = await reviewProposals(store, doc, proposals, options.yes ?? false);
      if (accepted === null) {
        console.log("Nothing written. Pass --yes to accept every proposal without a prompt.");
        return;
      }
      if (accepted.length === 0) {
        console.log("Nothing accepted, nothing written.");
        return;
      }
      await saveLearned(store, name, accepted);
      console.log(
        `Learned ${accepted.length} change${accepted.length === 1 ? "" : "s"} into "${name}".`,
      );
    },
  );

program
  .command("list")
  .description("List your saved patterns.")
  .action(async () => {
    const patterns = await new PatternStore().list();
    if (patterns.length === 0) {
      console.log("No patterns saved yet. Run `dolly extract` in a project to create your first.");
      return;
    }
    const width = Math.max(...patterns.map((p) => p.name.length));
    for (const { name, description, error } of patterns) {
      const note = error
        ? `invalid pattern.md; run \`dolly show ${name}\` for details`
        : description;
      console.log(note ? `${name.padEnd(width)}  ${note}` : name);
    }
  });

program
  .command("show")
  .argument("<name>", "pattern to display")
  .description("Print a saved pattern.")
  .action(async (name: string) => {
    const doc = await new PatternStore().load(name);
    process.stdout.write(serializePatternDocument(doc));
  });

program
  .command("edit")
  .argument("<name>", "pattern to edit")
  .description("Open a pattern in your editor, then validate it.")
  .action(async (name: string) => {
    const store = new PatternStore();
    if (!(await store.has(name))) throw new PatternNotFoundError(name);
    const editor = process.env.VISUAL || process.env.EDITOR;
    if (!editor) throw new Error("Set $EDITOR (or $VISUAL) so dolly knows which editor to open.");

    let editing = true;
    while (editing) {
      await openEditor(editor, store.pathOf(name));
      try {
        const doc = await store.load(name);
        console.log(`"${name}" saved and valid.`);
        if (doc.pattern.name !== name) {
          console.log(
            `Note: the frontmatter says "${doc.pattern.name}", but the pattern stays filed under "${name}".`,
          );
        }
        editing = false;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        editing = process.stdin.isTTY ? await confirmRetry() : false;
        if (!editing) process.exitCode = 1;
      }
    }
  });

program
  .command("delete")
  .argument("<name>", "pattern to delete")
  .description("Delete a saved pattern.")
  .action(async (name: string) => {
    await new PatternStore().delete(name);
    console.log(`Deleted pattern "${name}".`);
  });

program
  .command("export")
  .argument("<name>", "pattern to export")
  .option("-a, --as <target>", `what to write: ${EXPORT_TARGETS.join(", ")}`, "bundle")
  .option("-o, --out <path>", "where to write it (- for stdout, text targets only)")
  .option("-f, --force", "replace the file if it exists")
  .description("Pack a pattern as a .dolly bundle, or render it for an agent or an editor.")
  .action(async (name: string, options: { as: string; out?: string; force?: boolean }) => {
    const target = EXPORT_TARGETS.find((t) => t === options.as);
    if (!target)
      throw new Error(
        `Unknown export target "${options.as}"; one of: ${EXPORT_TARGETS.join(", ")}`,
      );
    const store = new PatternStore();
    if (options.out === "-") {
      if (target === "bundle") throw new Error("A bundle is a zip; give --out a file path.");
      process.stdout.write(renderExport(await store.load(name), target).contents);
      return;
    }
    const path = await exportPattern(store, name, target, options);
    console.log(`Exported "${name}" as ${target} to ${path}`);
  });

program
  .command("import")
  .argument("<file>", ".dolly bundle to import")
  .option("-f, --force", "replace an existing pattern with the same name")
  .description("Add a shared .dolly bundle to your patterns.")
  .action(async (file: string, options: { force?: boolean }) => {
    const pattern = await importBundle(new PatternStore(), file, { force: options.force });
    const description = pattern.description ? `: ${pattern.description}` : "";
    console.log(`Imported "${pattern.name}"${description}`);
  });

program
  .command("serve")
  .option("-p, --port <port>", "port to listen on (0 for an ephemeral one)", String(DEFAULT_PORT))
  .option("--open", "open the GUI in your browser")
  .description("Run the local daemon: browse, edit, and check patterns in the GUI.")
  .action(async (options: { port: string; open?: boolean }) => {
    const port = Number(options.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error(`"${options.port}" is not a port (0 to 65535).`);
    }
    const server = serveDolly({ port });
    console.log(`dolly is serving at ${server.url}`);
    if (!server.uiAvailable) {
      console.log("(API only: no built GUI found; run `bun run build` in apps/desktop.)");
    }
    console.log("Keep that URL to yourself: the token in it is this run's key. ctrl-c to stop.");
    if (options.open) openUrl(server.url);
    await new Promise(() => {}); // serves until interrupted
  });

const ai = program
  .command("ai")
  .description("The optional AI layer: bring your own key. Off by default, and off is fine.");

ai.command("status", { isDefault: true })
  .description("Show whether AI is on, with which provider and model.")
  .action(async () => {
    printAiStatus(await aiStatus());
  });

ai.command("connect")
  .argument("<provider>", "anthropic, openai, or google")
  .description("Store a provider key in the OS keychain, verified with a live call first.")
  .action(async (provider: string) => {
    // Refuse a bad provider before asking for the key, not after.
    if (!(provider in PROVIDERS)) {
      throw new Error(`Unknown provider "${provider}". Pick one of: anthropic, openai, google.`);
    }
    const key = await readSecret(`Paste your ${provider} API key (input hidden): `);
    const status = await connectAi(provider, key);
    console.log("Key verified and stored in the OS keychain.");
    printAiStatus(status);
  });

ai.command("use")
  .argument("<provider>", "anthropic, openai, or google")
  .option("-m, --model <id>", "model to use (default: the provider's own default)")
  .description("Pick the active provider, and optionally the model.")
  .action(async (provider: string, options: { model?: string }) => {
    printAiStatus(await useAi(provider, options.model));
  });

ai.command("off")
  .description("Turn the AI layer off. Stored keys stay in the keychain.")
  .action(async () => {
    await aiOff();
    console.log("AI is off. Keys stay in the keychain; `dolly ai use` turns it back on.");
  });

program
  .command("home")
  .description("Print where dolly stores its data on this machine.")
  .action(() => {
    console.log(dollyHome());
  });

function printFitPlan(name: string, plan: FitPlan): void {
  if (plan.diagnostics.length > 0) {
    console.log("Pattern issues (fix the pattern, not the project):");
    for (const line of plan.diagnostics) console.log(`  ${line}`);
    console.log("");
  }
  if (plan.steps.length === 0 && plan.declined.length === 0) {
    console.log(`Nothing to fit: this project follows "${name}".`);
    return;
  }
  for (const step of plan.steps) {
    if (step.kind === "fix") {
      console.log(`${step.plan.kind.padEnd(7)} ${step.path}: ${step.reason}`);
    } else if (step.kind === "move") {
      console.log(`move    ${step.from} → ${step.to}: ${step.reason}`);
      for (const rewrite of step.rewrites) {
        console.log(`        ${rewrite.file}: "${rewrite.from}" → "${rewrite.to}"`);
      }
    } else {
      console.log(`translate ${step.from} → ${step.to}: ${step.reason}`);
    }
  }
  const translations = plan.steps.filter((s) => s.kind === "translate");
  if (translations.length > 0) {
    const bytes = translations.reduce((n, s) => n + (s.kind === "translate" ? s.bytes : 0), 0);
    console.log(
      `${translations.length} file${translations.length === 1 ? "" : "s"} (${Math.ceil(bytes / 1024)} KiB) would go to the model under --apply; the pattern's typecheck and test commands judge the result before any source is removed.`,
    );
  }
  if (plan.declined.length > 0) {
    if (plan.steps.length > 0) console.log("");
    console.log("Left to you:");
    for (const item of plan.declined) {
      console.log(`  ${item.path}: ${item.message}`);
      if (item.suggestion) {
        console.log(
          `    ai (${item.suggestion.model}) suggests ${item.suggestion.pick}: ${item.suggestion.why}`,
        );
      }
    }
  }
}

/** Watches until ctrl-c, narrating proposals as they appear; resolves with the last set. */
function watchUntilStopped(
  store: PatternStore,
  name: string,
  dir: string,
): Promise<{ proposals: Proposal[]; changed: string[] }> {
  return new Promise((resolve) => {
    let latest: Proposal[] = [];
    const seen = new Set<string>();
    let first = true;
    const watcher = watchLearning(
      store,
      name,
      dir,
      (proposals) => {
        latest = proposals;
        for (const proposal of proposals) {
          const key = `${pathLabel(proposal.path)}=${JSON.stringify(proposal.value)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          console.log(`learned ${pathLabel(proposal.path)}: ${proposal.reason}`);
        }
        if (first) {
          console.log(
            `Watching for changes to learn from (ctrl-c to review${proposals.length ? "" : "; nothing to propose yet"}).`,
          );
          first = false;
        }
      },
      (error) => {
        console.error(error instanceof Error ? error.message : String(error));
      },
    );
    process.once("SIGINT", () => {
      console.log("");
      resolve({ proposals: latest, changed: watcher.stop() });
    });
  });
}

/**
 * Each proposal as the diff it would make, accepted or skipped one by one.
 * Returns null when there is no one to ask and --yes was not given.
 */
async function reviewProposals(
  store: PatternStore,
  doc: PatternDocument,
  proposals: Proposal[],
  acceptAll: boolean,
): Promise<Proposal[] | null> {
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  const accepted: Proposal[] = [];
  const rl =
    acceptAll || !interactive
      ? null
      : createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (const [index, proposal] of proposals.entries()) {
      console.log(
        `\n[${index + 1}/${proposals.length}] ${pathLabel(proposal.path)}: ${proposal.reason}`,
      );
      console.log(await renderProposal(store, doc, proposal));
      if (!rl) {
        if (acceptAll) accepted.push(proposal);
        continue;
      }
      const answer = (await rl.question("Accept? [y/n/q] ")).trim().toLowerCase();
      if (answer === "q") break;
      if (answer === "y" || answer === "yes") accepted.push(proposal);
    }
  } finally {
    rl?.close();
  }
  return acceptAll || interactive ? accepted : null;
}

function printCheckReport(name: string, report: CheckReport): void {
  for (const line of report.fixed) console.log(`fixed  ${line}`);
  // Pattern defects are the pattern author's to fix, shown apart from the
  // project's violations so a broken pattern can never pass as a clean tree.
  if (report.diagnostics.length > 0) {
    console.log(`Pattern issues (fix the pattern, not the project):`);
    for (const line of report.diagnostics) console.log(`  ${line}`);
  }
  if (report.violations.length === 0) {
    console.log(`Clean: this project follows "${name}".`);
    return;
  }
  if (report.fixed.length > 0 || report.diagnostics.length > 0) console.log("");
  for (const v of report.violations) {
    console.log(`${v.rule.padEnd(8)} ${v.path}: ${v.message}${v.fix ? " [fixable]" : ""}`);
  }
  const fixable = report.violations.filter((v) => v.fix).length;
  const plural = report.violations.length === 1 ? "" : "s";
  console.log(
    `\n${report.violations.length} violation${plural}${fixable > 0 ? ` (${fixable} fixable; run \`dolly check --fix\`)` : ""}.`,
  );
}

function printAiStatus(status: AiStatus): void {
  if (!status.provider) {
    console.log("AI is off. Connect a provider with `dolly ai connect <anthropic|openai|google>`.");
    return;
  }
  const key =
    status.keySource === "missing"
      ? `no key found; run \`dolly ai connect ${status.provider}\` or set ${PROVIDERS[status.provider].envVars[0]}`
      : `key from the ${status.keySource}`;
  console.log(`AI is on: ${status.provider}, model ${status.model} (${key}).`);
}

/**
 * Read a secret without echoing it. Keys are never taken as flags: argv is
 * visible to every process on the machine and lands in shell history. Piped
 * stdin works for scripts (`dolly ai connect anthropic < key.txt`).
 */
async function readSecret(promptText: string): Promise<string> {
  if (!process.stdin.isTTY) {
    let data = "";
    for await (const chunk of process.stdin) data += chunk;
    return (data.split("\n", 1)[0] ?? "").trim();
  }
  process.stdout.write(promptText);
  process.stdin.setRawMode(true);
  return await new Promise<string>((resolve) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          process.exit(130);
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(buffer);
          return;
        }
        if (char === "\u007f" || char === "\b") {
          buffer = buffer.slice(0, -1);
        } else if (char >= " ") {
          buffer += char;
        }
      }
    };
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
    };
    process.stdin.on("data", onData);
    process.stdin.resume();
  });
}

/** Best-effort browser launch; the printed URL is the real interface. */
function openUrl(url: string): void {
  const opener =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    Bun.spawn(opener, { stdout: "ignore", stderr: "ignore" });
  } catch {
    // No opener on this system; the printed URL still works.
  }
}

/** $EDITOR may carry flags (e.g. "code --wait"), so split on whitespace. */
async function openEditor(editor: string, file: string): Promise<void> {
  const command = editor.trim().split(/\s+/);
  const exitCode = await Bun.spawn([...command, file], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).exited;
  if (exitCode !== 0) {
    throw new Error(`${command[0]} exited with code ${exitCode}, so validation was skipped.`);
  }
}

async function confirmRetry(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Reopen the editor to fix it? [Y/n] ");
  rl.close();
  return answer.trim().toLowerCase() !== "n";
}

try {
  await program.parseAsync();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    error instanceof PatternExistsError ? `${message} Pass --force to replace it.` : message,
  );
  process.exitCode = 1;
}
