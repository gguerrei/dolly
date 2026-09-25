import type { Commits } from "../pattern/schema";
import { runGit } from "../tree/git";

/**
 * Votes the commits facet from the subject lines of recent history, the
 * first scanner to read past the working tree. Absent without a
 * repository, without git, or with too little history; a style short of
 * the bar degrades to a counted note like every other facet.
 */
export const COMMITS_TUNING = {
  /** How far back the vote reads: non-merge commits from HEAD. */
  sample: 200,
  /** Fewer subjects than this (for the style, or for the case vote) and nothing is emitted. */
  minSample: 10,
  /** A style or a subject case becomes a facet iff it holds in ≥ 80% of its sample… */
  winRatio: [8, 10] as const,
  /** …and a style holding in at least half becomes a note instead. */
  noteRatio: [1, 2] as const,
  /** A conventional type joins the list once it appears this often. */
  minTypeCount: 2,
};

const CONVENTIONAL = /^([a-z][a-z0-9-]*)(\([^()]+\))?!?: (\S.*)$/;
const GITMOJI = /^(?:\p{Extended_Pictographic}|:[a-z0-9_+-]+:)\s*(.*)$/u;

export interface CommitsScan {
  commits?: Commits;
  notes: string[];
}

interface Subject {
  style: "conventional" | "gitmoji" | "free";
  type?: string;
  scoped: boolean;
  /** The human part of the line: after the type or the emoji, the whole line otherwise. */
  text: string;
}

function parseSubject(line: string): Subject {
  const conventional = line.match(CONVENTIONAL);
  if (conventional) {
    return {
      style: "conventional",
      type: conventional[1],
      scoped: conventional[2] !== undefined,
      text: conventional[3] as string,
    };
  }
  const gitmoji = line.match(GITMOJI);
  if (gitmoji) return { style: "gitmoji", scoped: false, text: gitmoji[1] as string };
  return { style: "free", scoped: false, text: line };
}

const clears = (count: number, total: number, [num, den]: readonly [number, number]) =>
  count * den >= total * num;

export async function scanCommits(root: string): Promise<CommitsScan> {
  const log = await runGit(root, "log", "--no-merges", `-n${COMMITS_TUNING.sample}`, "--format=%s");
  if (!log.ok) return { notes: [] };
  const subjects = log.out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseSubject);
  if (subjects.length < COMMITS_TUNING.minSample) return { notes: [] };

  const notes: string[] = [];
  const tally = (style: Subject["style"]) => subjects.filter((s) => s.style === style).length;
  const counts = { conventional: tally("conventional"), gitmoji: tally("gitmoji") };
  const winner = (["conventional", "gitmoji"] as const).find((style) =>
    clears(counts[style], subjects.length, COMMITS_TUNING.winRatio),
  );
  for (const style of ["conventional", "gitmoji"] as const) {
    if (winner === undefined && clears(counts[style], subjects.length, COMMITS_TUNING.noteRatio)) {
      notes.push(
        `${counts[style]} of ${subjects.length} recent commits follow ${
          style === "conventional" ? "Conventional Commits" : "gitmoji"
        }; set \`commits.style\` by hand if intentional.`,
      );
    }
  }

  const subject = voteCase(subjects);
  if (winner === undefined) {
    // A free style is only worth stating when it says how subjects read.
    return subject ? { commits: { style: "free", types: [], subject }, notes } : { notes };
  }
  const facet: Commits = { style: winner, types: [], ...(subject ? { subject } : {}) };
  if (winner === "conventional") {
    const conventional = subjects.filter((s) => s.style === "conventional");
    const byType = new Map<string, number>();
    for (const s of conventional)
      byType.set(s.type as string, (byType.get(s.type as string) ?? 0) + 1);
    facet.types = [...byType]
      .filter(([, n]) => n >= COMMITS_TUNING.minTypeCount)
      .map(([type]) => type)
      .sort();
    const scoped = conventional.filter((s) => s.scoped).length;
    facet.scope =
      scoped === 0
        ? "never"
        : clears(scoped, conventional.length, COMMITS_TUNING.winRatio)
          ? "required"
          : "optional";
  }
  return { commits: facet, notes };
}

/** The case of the first letter of the subject text, over the subjects that start with one. */
function voteCase(subjects: Subject[]): Commits["subject"] {
  const lettered = subjects.map((s) => s.text[0] ?? "").filter((c) => /[A-Za-z]/.test(c));
  if (lettered.length < COMMITS_TUNING.minSample) return undefined;
  const lower = lettered.filter((c) => c === c.toLowerCase()).length;
  if (clears(lower, lettered.length, COMMITS_TUNING.winRatio)) return "lower";
  if (clears(lettered.length - lower, lettered.length, COMMITS_TUNING.winRatio)) return "sentence";
  return undefined;
}
