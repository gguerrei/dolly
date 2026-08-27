import type { Testing } from "../pattern/schema";
import type { Inventory } from "../tree/inventory";

/**
 * Votes the testing facet from where test files actually sit and what they
 * are called. Placement is `separate` when a test file lives under a test
 * root (test/, tests/, __tests__, spec/), `colocated` otherwise; the file
 * pattern generalizes each basename (`user.test.ts` → `{stem}.test.ts`).
 * Mixed evidence degrades to a counted note, never a facet (ADR-0003).
 */
export const TESTING_TUNING = {
  /** A placement becomes a facet iff winner ≥ 80% of the sample… */
  winRatio: [8, 10] as const,
  /** …over at least this many test files. */
  minSample: 2,
};

const TEST_ROOTS = new Set(["test", "tests", "__tests__", "spec"]);

/** Basename shapes that mark a file as a test, most specific first. */
const NAME_SHAPES: { pattern: RegExp; generalize: (basename: string) => string }[] = [
  {
    pattern: /^(.+)\.test\.([a-z0-9]+)$/,
    generalize: (b) => b.replace(/^.+\.test\./, "{stem}.test."),
  },
  {
    pattern: /^(.+)\.spec\.([a-z0-9]+)$/,
    generalize: (b) => b.replace(/^.+\.spec\./, "{stem}.spec."),
  },
  { pattern: /^test_(.+)\.py$/, generalize: () => "test_{stem}.py" },
  {
    pattern: /^(.+)_test\.([a-z0-9]+)$/,
    generalize: (b) => b.replace(/^.+_test\./, "{stem}_test."),
  },
];

/** True when the basename reads as a test file in any supported convention. */
export function isTestFile(path: string): boolean {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  return NAME_SHAPES.some(({ pattern }) => pattern.test(basename));
}

/** Where this test file sits: under a test root, or next to what it tests. */
export function placementOf(path: string): "colocated" | "separate" {
  return path
    .split("/")
    .slice(0, -1)
    .some((segment) => TEST_ROOTS.has(segment))
    ? "separate"
    : "colocated";
}

/** The `{stem}` generalization of a test basename, e.g. "{stem}.test.ts". */
export function filePatternOf(path: string): string | undefined {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  const shape = NAME_SHAPES.find(({ pattern }) => pattern.test(basename));
  return shape?.generalize(basename);
}

/** The stem a test basename carries ("user.test.ts" → "user"); fit names moves with it. */
export function testStemOf(path: string): string | undefined {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  for (const { pattern } of NAME_SHAPES) {
    const match = basename.match(pattern);
    if (match) return match[1];
  }
  return undefined;
}

/** The separate-placement roots fit may move tests into. */
export const TEST_ROOT_NAMES: ReadonlySet<string> = TEST_ROOTS;

export interface TestingScan {
  testing?: Testing;
  notes: string[];
}

export function scanTesting(inventory: Inventory): TestingScan {
  const notes: string[] = [];
  const tests = inventory.files.filter((f) => isTestFile(f.path)).map((f) => f.path);
  if (tests.length < TESTING_TUNING.minSample) return { notes };

  const [num, den] = TESTING_TUNING.winRatio;
  const dominant = <T extends string>(values: T[]): T | undefined => {
    const counts = new Map<T, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    // Sort for a deterministic winner even in a dead heat (which cannot emit).
    const [winner, votes] = [...counts.entries()].sort(
      ([a, av], [b, bv]) => bv - av || (a < b ? -1 : 1),
    )[0] as [T, number];
    return votes * den >= values.length * num ? winner : undefined;
  };

  const placement = dominant(tests.map(placementOf));
  if (!placement) {
    const separate = tests.filter((t) => placementOf(t) === "separate").length;
    notes.push(
      `Test files are split between separate (${separate}) and colocated (${tests.length - separate}) placement, with no ≥80% convention; set the testing facet by hand.`,
    );
    return { notes };
  }

  const filePattern = dominant(
    tests.map(filePatternOf).filter((p): p is string => p !== undefined),
  );
  if (!filePattern) {
    notes.push(
      `Test files agree on ${placement} placement but not on one naming shape, so the testing facet is emitted without filePattern; add one by hand if wanted.`,
    );
  }
  return { testing: { placement, ...(filePattern ? { filePattern } : {}) }, notes };
}
