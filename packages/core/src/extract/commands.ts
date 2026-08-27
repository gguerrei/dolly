import { join } from "node:path";
import type { Commands, Toolchain } from "../pattern/schema";
import { scanRecipes, TASKFILE_NAMES } from "../taskfile";
import { type Inventory, rootFiles } from "../tree/inventory";

/**
 * Extracts canonical dev verbs (test, lint, build…) from the one place the
 * repo's resolved task runner keeps them: package.json scripts, a justfile,
 * or a Makefile. A verb becomes a facet only when its command would run
 * verbatim in a fresh project; entangled recipes degrade to prose notes.
 */

/** The closed verb vocabulary extraction promotes; users can hand-add more. */
const CANONICAL_VERBS = new Set([
  "build",
  "check",
  "clean",
  "dev",
  "docs",
  "format",
  "lint",
  "start",
  "test",
  "typecheck",
]);

/** Common spellings folded into their canonical verb. */
const VERB_ALIASES: Record<string, string> = { fmt: "format", "type-check": "typecheck" };

export interface CommandsScan {
  commands?: Commands;
  notes: string[];
}

export async function scanCommands(
  inventory: Inventory,
  toolchain: Toolchain | undefined,
): Promise<CommandsScan> {
  const notes: string[] = [];
  // The toolchain facet already resolved which task runner owns the verbs;
  // reading any other source could contradict it (ADR-0003: one owner).
  const runner = toolchain?.taskRunner;
  let commands: Commands | undefined;

  if (runner === "npm-scripts") {
    commands = await fromManifestScripts(inventory, notes);
  } else if (runner === "just" || runner === "make") {
    const file = rootFile(inventory, TASKFILE_NAMES[runner]);
    if (file) commands = await fromTaskfile(inventory, file, runner, notes);
  }

  if (commands && Object.keys(commands).length === 0) commands = undefined;
  return { commands, notes };
}

async function fromManifestScripts(
  inventory: Inventory,
  notes: string[],
): Promise<Commands | undefined> {
  let scripts: Record<string, string>;
  try {
    const manifest = JSON.parse(await Bun.file(join(inventory.root, "package.json")).text()) as {
      scripts?: Record<string, string>;
    };
    scripts = manifest.scripts ?? {};
  } catch {
    return undefined;
  }

  const commands: Commands = {};
  const entries = Object.entries(scripts).filter(
    ([, body]) => typeof body === "string" && body.trim() !== "",
  );
  // Canonical spellings claim their verb before aliases can shadow them.
  for (const [name, body] of entries) {
    if (CANONICAL_VERBS.has(name)) commands[name] = body.trim();
  }
  for (const [name, body] of entries) {
    const verb = VERB_ALIASES[name];
    if (verb && !(verb in commands)) commands[verb] = body.trim();
  }

  // A captured command must run in a scaffolded manifest, which will contain
  // only the canonical verbs, so drop bodies that call scripts left behind.
  // Dropping one verb can orphan another that ran it, so sweep until the
  // surviving set is closed.
  const referencedScripts = (body: string): string[] => {
    const refs = [...body.matchAll(/\b(?:npm|pnpm|yarn|bun) run\s+([\w:.-]+)/g)].map(
      (m) => m[1] as string,
    );
    // yarn and pnpm also run scripts without `run`; count those only when the
    // name really is a script, so `yarn install` never reads as a reference.
    for (const m of body.matchAll(/\b(?:pnpm|yarn)\s+(?!run\b)([\w:.-]+)/g)) {
      if (Object.hasOwn(scripts, m[1] as string)) refs.push(m[1] as string);
    }
    return refs;
  };
  let dropped = true;
  while (dropped) {
    dropped = false;
    for (const [verb, body] of Object.entries(commands)) {
      const missing = referencedScripts(body).filter((name) => !(name in commands));
      if (missing.length > 0) {
        delete commands[verb];
        dropped = true;
        notes.push(
          `Script "${verb}" runs ${missing.map((m) => `"${m}"`).join(", ")}, which a scaffolded manifest will not carry; add both to commands by hand if wanted.`,
        );
      }
    }
  }
  return sortedCommands(commands);
}

/**
 * Recipes qualify only when self-contained: no parameters, no dependencies,
 * exactly one body line; anything else cannot be replayed into a fresh
 * taskfile without guessing.
 */
async function fromTaskfile(
  inventory: Inventory,
  file: string,
  runner: "just" | "make",
  notes: string[],
): Promise<Commands | undefined> {
  const text = await Bun.file(join(inventory.root, file)).text();
  const commands: Commands = {};

  for (const { name, params, rest, body } of scanRecipes(text, runner)) {
    const verb = CANONICAL_VERBS.has(name) ? name : VERB_ALIASES[name];
    if (!verb) continue;

    if (params !== "" || rest !== "" || body.length !== 1) {
      notes.push(
        `${file}'s "${name}" recipe takes parameters, depends on other recipes, or spans multiple lines; add a commands entry by hand if wanted.`,
      );
      continue;
    }
    const command = (body[0] as string).replace(/^[@-]+\s*/, "");
    // Variables live in the taskfile header, which no scaffold reproduces, so
    // a recipe that reads one would not run in a fresh project.
    const variable = runner === "just" ? /\{\{/ : /\$[({]/;
    if (variable.test(command)) {
      notes.push(
        `${file}'s "${name}" recipe reads a ${runner} variable defined in the file's header, so it would not run verbatim; add a commands entry by hand if wanted.`,
      );
      continue;
    }
    // Canonical spellings own their verb; an alias only fills a gap.
    if (CANONICAL_VERBS.has(name) || !(verb in commands)) commands[verb] = command;
  }
  return sortedCommands(commands);
}

/** Deterministic facet order regardless of how the source file was written. */
function sortedCommands(commands: Commands): Commands {
  return Object.fromEntries(Object.entries(commands).sort(([a], [b]) => (a < b ? -1 : 1)));
}

function rootFile(inventory: Inventory, names: string[]): string | undefined {
  const atRoot = rootFiles(inventory);
  return names.find((name) => atRoot.has(name));
}
