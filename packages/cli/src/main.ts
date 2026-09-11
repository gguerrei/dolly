#!/usr/bin/env bun
import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  type AiStatus,
  aiOff,
  aiStatus,
  assistedCheck,
  assistedFit,
  assistedFitApply,
  type CheckReport,
  type ConventionsReport,
  checkProject,
  connectAi,
  dollyHome,
  draftConventions,
  EXPORT_TARGETS,
  exportPattern,
  extractFromRepos,
  extractPattern,
  type FitPlan,
  facetNames,
  gitStateOf,
  ignorePaths,
  importBundle,
  learnDrift,
  linkProject,
  type PatternDocument,
  PatternExistsError,
  PatternNotFoundError,
  PatternStore,
  PROVIDERS,
  type Proposal,
  parsePatternDocument,
  pathLabel,
  renderExport,
  renderProposal,
  resolvePattern,
  saveExtractedPattern,
  saveLearned,
  scaffoldProject,
  serializePatternDocument,
  useAi,
  VENDOR_DIR,
  verifyAi,
  watchLearning,
  watchProject,
} from "@dollysheep/core";
import { Command } from "commander";
import pkg from "../package.json";
import { renderCompletions, SHELLS, type Shell } from "./completions";
import { DEFAULT_PORT, serveDolly } from "./serve";
import { checkView } from "./views";

const program = new Command("dolly")
  .description("Save your project's organization patterns. Apply them anywhere.")
  .version(pkg.version);

program
  .command("extract")
  .argument("[paths...]", "project to learn from; several keep what they agree on", ["."])
  .option("-n, --name <name>", "name for the new pattern (default: the directory name)")
  .option("-f, --force", "replace an existing pattern with the same name")
  .description("Infer a pattern from a real project, or from what several agree on.")
  .action(async (paths: string[], options: { name?: string; force?: boolean }) => {
    const store = new PatternStore();
    if (paths.length > 1 && !options.name) {
      throw new Error("Name the pattern with --name when extracting from several projects.");
    }
    const result =
      paths.length > 1
        ? await extractFromRepos(paths, options.name as string)
        : await extractPattern(paths[0] as string, options.name);
    const { pattern } = result.document;
    if ((await store.has(pattern.name)) && !options.force) {
      throw new PatternExistsError(pattern.name);
    }
    await saveExtractedPattern(store, result);

    const facets = facetNames(pattern).join(", ");
    const captured = Object.keys(result.files).filter((file) =>
      file.startsWith("toolchain/"),
    ).length;
    const from = paths.length > 1 ? ` from ${paths.length} projects` : "";
    console.log(
      `Saved pattern "${pattern.name}"${from} (facets: ${facets || "none"}${captured ? `; ${captured} config${captured === 1 ? "" : "s"} captured` : ""}).`,
    );
    if (!facets) {
      console.log(
        `Nothing in ${paths.join(", ")} was recognizable as a project, so the pattern has no facets.`,
      );
    }
    console.log(
      paths.length > 1
        ? `Review it with \`dolly show ${pattern.name}\`. The notes say what the projects disagree on, and what each fell short of.`
        : `Review it with \`dolly show ${pattern.name}\`. Extraction notes list what fell short of a facet.`,
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
  .option("--json", "print the report as JSON (one line per report under --watch)")
  .option(
    "--conventions",
    "with AI on, have the model read the prose conventions against the changed code files (reported apart, never counted)",
  )
  .description("Check a project against its pattern.")
  .action(
    async (
      patternArg: string | undefined,
      options: {
        dir: string;
        fix?: boolean;
        watch?: boolean;
        json?: boolean;
        conventions?: boolean;
      },
    ) => {
      if (options.fix && options.watch) {
        throw new Error(
          "--watch and --fix do not combine: a watcher that edits the tree it watches is a feedback loop.",
        );
      }
      if (options.conventions && options.watch) {
        throw new Error(
          "--watch and --conventions do not combine: a watcher would call the model on every save.",
        );
      }
      const ref = await resolvePattern(new PatternStore(), options.dir, patternArg);
      if (!ref) {
        throw new Error(
          "No pattern named and no .dolly marker here. Run `dolly check <pattern>` (dolly new writes the marker for you).",
        );
      }
      const { store, name } = ref;
      const print = (report: CheckReport) =>
        options.json
          ? console.log(JSON.stringify(checkView(name, report)))
          : printCheckReport(name, report);
      if (!options.watch) {
        // The deterministic report, plus the model's reading of the prose when asked.
        const report = options.conventions
          ? await assistedCheck(store, name, options.dir, { fix: options.fix, conventions: true })
          : await checkProject(store, name, options.dir, { fix: options.fix });
        print(report);
        if (failing(report)) process.exitCode = 1;
        return;
      }
      // The engine owns the watch loop; the CLI only prints what it reports.
      let first = true;
      watchProject(
        store,
        name,
        options.dir,
        (report) => {
          if (!first && !options.json) console.log("");
          print(report);
          if (first && !options.json) console.log("\nWatching for changes (ctrl-c to stop).");
          first = false;
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
    const ref = await resolvePattern(new PatternStore(), options.dir, patternArg);
    if (!ref) {
      throw new Error(
        "No pattern named and no .dolly marker here. Run `dolly fit <pattern>` (dolly new writes the marker for you).",
      );
    }
    const { store, name } = ref;
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
    console.log("");
    if (result.checkpoint) {
      console.log(`Checkpoint: branch ${result.checkpoint} holds the tree as it was.`);
    }
    for (const line of result.applied) console.log(`applied  ${line}`);
    for (const line of result.verified) console.log(`verified ${line}`);
    for (const line of result.failures) console.log(`FAILED   ${line}`);
    if (result.failures.length > 0) process.exitCode = 1;
    if (result.committed) {
      console.log(`Committed on the current branch. \`git switch ${result.checkpoint}\` reverts.`);
    }
  });

program
  .command("link")
  .argument("<pattern>", "pattern to link the project to")
  .option("-C, --dir <dir>", "project directory to link", ".")
  .option(
    "--vendor",
    `copy the pattern into the project under ${VENDOR_DIR}/, so a checkout carries it for CI and teammates`,
  )
  .description("Write the .dolly marker, so check and fit resolve the pattern without a name.")
  .action(async (pattern: string, options: { dir: string; vendor?: boolean }) => {
    const store = new PatternStore();
    if (!(await store.has(pattern))) throw new PatternNotFoundError(pattern);
    const { replaced, vendored } = await linkProject(options.dir, pattern, {
      ...(options.vendor ? { vendorFrom: store } : {}),
    });
    const was = replaced ? ` (it was linked to "${replaced}")` : "";
    const commit = vendored
      ? `Commit .dolly and ${vendored}/ so every checkout checks against the same pattern.`
      : "Commit .dolly so the whole team checks against the same pattern.";
    console.log(`Linked ${options.dir} to "${pattern}"${was}. ${commit}`);
  });

program
  .command("ignore")
  .argument("<paths...>", "relative paths, with * and **, that check leaves alone")
  .option("-C, --dir <dir>", "project directory whose marker to edit", ".")
  .description(
    "Add paths to the .dolly marker's ignore list: known violations set aside, counted, never fixed.",
  )
  .action(async (paths: string[], options: { dir: string }) => {
    const marker = await ignorePaths(options.dir, paths);
    console.log(
      `Ignoring ${marker.ignore.length} path${marker.ignore.length === 1 ? "" : "s"} in ${options.dir}: ${marker.ignore.join(", ")}.`,
    );
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
      const ref = await resolvePattern(new PatternStore(), options.dir, patternArg);
      if (!ref) {
        throw new Error(
          "No pattern named and no .dolly marker here. Run `dolly learn <pattern>` (dolly new writes the marker for you).",
        );
      }
      const { store, name } = ref;
      if (!(await store.has(name))) throw new PatternNotFoundError(name);
      const { proposals, changed } = options.once
        ? { proposals: await learnDrift(store, name, options.dir), changed: [] }
        : await watchUntilStopped(store, name, options.dir);
      // The one model call of a session, and only with the layer on; a provider
      // failure is said in its words, and the deterministic proposals stand.
      const doc = await store.load(name);
      try {
        proposals.push(...(await draftConventions(doc, options.dir, changed, proposals)));
      } catch (error) {
        console.error(
          `Conventions were not drafted: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
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
  .argument(
    "[file]",
    "a captured file inside it (toolchain/… or templates/…) instead of pattern.md",
  )
  .description("Open a pattern in your editor, then validate it.")
  .action(async (name: string, file: string | undefined) => {
    const store = new PatternStore();
    if (!(await store.has(name))) throw new PatternNotFoundError(name);
    const editor = process.env.VISUAL || process.env.EDITOR;
    if (!editor) throw new Error("Set $EDITOR (or $VISUAL) so dolly knows which editor to open.");

    // A captured file is the author's own bytes: opened in place, nothing to validate.
    if (file) {
      const target = store.fileOf(name, file);
      if (!(await Bun.file(target).exists())) {
        const files = await store.files(name);
        throw new Error(
          `"${name}" has no captured file ${file}${files.length ? `; it has ${files.join(", ")}` : ""}.`,
        );
      }
      await openEditor(editor, target);
      console.log(`${file} of "${name}" saved.`);
      return;
    }

    // The editor works on a copy; the store's own file changes only once the copy parses.
    const draft = join(tmpdir(), `dolly-edit-${name}-${process.pid}.md`);
    await copyFile(store.pathOf(name), draft);
    let editing = true;
    while (editing) {
      await openEditor(editor, draft);
      const source = await readFile(draft, "utf8");
      try {
        const doc = parsePatternDocument(source);
        await writeFile(store.pathOf(name), source);
        await rm(draft, { force: true });
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
        if (!editing) {
          console.error(`Nothing written. Your edit is kept at ${draft}.`);
          process.exitCode = 1;
        }
      }
    }
  });

program
  .command("delete")
  .argument("<name>", "pattern to delete")
  .description("Delete a saved pattern.")
  .action(async (name: string) => {
    const store = new PatternStore();
    if (!(await store.has(name))) throw new PatternNotFoundError(name);
    if (process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const typed = (
        await rl.question(`Type "${name}" to delete it and its captured files: `)
      ).trim();
      rl.close();
      if (typed !== name) {
        console.log("Kept.");
        return;
      }
    }
    await store.delete(name);
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
  .argument("<source>", ".dolly bundle to import: a file path, or an https URL")
  .option("-f, --force", "replace an existing pattern with the same name")
  .description("Add a shared .dolly bundle to your patterns.")
  .action(async (source: string, options: { force?: boolean }) => {
    const pattern = await importBundle(new PatternStore(), source, { force: options.force });
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
    const server = await serveDolly({ port });
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
  .option("--verify", "make one live call, so a revoked key shows here and not inside a consumer")
  .description("Show whether AI is on, with which provider and model.")
  .action(async (options: { verify?: boolean }) => {
    if (!options.verify) {
      printAiStatus(await aiStatus());
      return;
    }
    const { status, error } = await verifyAi();
    printAiStatus(status);
    if (!status.provider || status.keySource === "missing") return;
    console.log(error ? `The key was refused: ${error}` : "The key works: the provider answered.");
    if (error) process.exitCode = 1;
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
  .command("completions")
  .argument("<shell>", `the shell to complete for: ${SHELLS.join(", ")}`)
  .description("Print a completion script for your shell; the header says where to put it.")
  .action((shell: string) => {
    if (!SHELLS.includes(shell as Shell)) {
      throw new Error(`Unknown shell "${shell}"; one of: ${SHELLS.join(", ")}.`);
    }
    process.stdout.write(renderCompletions(program, shell as Shell));
  });

program
  .command("home")
  .description("Print where dolly stores its data on this machine.")
  .action(() => {
    console.log(dollyHome());
  });

/** How much of a fix's patch the dry run prints before cutting it short. */
const PREVIEW_LINES = 12;

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
      // The patch itself, the way a move shows its rewrites; a long create is cut short.
      const lines = step.preview.split("\n").filter((line) => line !== "");
      const shown = lines.slice(0, PREVIEW_LINES);
      for (const line of shown) console.log(`        ${line}`);
      if (lines.length > shown.length) {
        console.log(
          `        … ${lines.length - shown.length} more line${lines.length - shown.length === 1 ? "" : "s"}`,
        );
      }
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
      if (item.aiError) console.log(`    ai: ${item.aiError}`);
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

/** Exit 1 is the CI contract, and a warning (the marker's `rules`) never trips it. */
function failing(report: CheckReport): boolean {
  return report.violations.some((v) => v.severity !== "warning");
}

function printCheckReport(name: string, report: CheckReport): void {
  for (const line of report.fixed) console.log(`fixed  ${line}`);
  // Pattern defects are the pattern author's to fix, shown apart from the
  // project's violations so a broken pattern can never pass as a clean tree.
  if (report.diagnostics.length > 0) {
    console.log(`Pattern issues (fix the pattern, not the project):`);
    for (const line of report.diagnostics) console.log(`  ${line}`);
  }
  const ignored =
    report.ignored > 0
      ? ` (${report.ignored} violation${report.ignored === 1 ? "" : "s"} ignored by .dolly)`
      : "";
  if (report.violations.length === 0) {
    console.log(`Clean: this project follows "${name}"${ignored}.`);
    if (report.conventions) printConventions(report.conventions);
    return;
  }
  if (report.fixed.length > 0 || report.diagnostics.length > 0) console.log("");
  for (const v of report.violations) {
    const tags = `${v.fix ? " [fixable]" : ""}${v.severity === "warning" ? " [warning]" : ""}`;
    console.log(`${v.rule.padEnd(8)} ${v.path}: ${v.message}${tags}`);
  }
  const fixable = report.violations.filter((v) => v.fix).length;
  const warnings = report.violations.filter((v) => v.severity === "warning").length;
  const plural = report.violations.length === 1 ? "" : "s";
  const notes = [
    ...(fixable > 0 ? [`${fixable} fixable; run \`dolly check --fix\``] : []),
    ...(warnings > 0
      ? [`${warnings} warning${warnings === 1 ? "" : "s"} by .dolly, not counted`]
      : []),
  ];
  console.log(
    `\n${report.violations.length} violation${plural}${notes.length ? ` (${notes.join("; ")})` : ""}${ignored}.`,
  );
  if (report.conventions) printConventions(report.conventions);
}

/** The model's findings, in their own section: labeled as its reading, and never in the count above. */
function printConventions(conventions: ConventionsReport): void {
  console.log(`\nConventions, as ${conventions.model} reads them (not counted):`);
  if (conventions.findings.length === 0) console.log("  nothing to report");
  for (const finding of conventions.findings) {
    console.log(`  ${finding.path}${finding.line ? `:${finding.line}` : ""}: ${finding.message}`);
  }
  for (const line of conventions.skipped) console.log(`  skipped ${line}`);
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
