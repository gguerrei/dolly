/**
 * A small line diff for showing what a proposal would change in pattern.md.
 * Longest common subsequence over lines, rendered unified-style with two
 * lines of context; patterns are short, so the quadratic table is fine.
 */

const CONTEXT = 2;

type Edit = { kind: " " | "-" | "+"; line: string };

export function unifiedDiff(before: string, after: string): string {
  const edits = diffLines(before.split("\n"), after.split("\n"));
  const keep = new Set<number>();
  edits.forEach((edit, index) => {
    if (edit.kind === " ") return;
    for (
      let i = Math.max(0, index - CONTEXT);
      i <= Math.min(edits.length - 1, index + CONTEXT);
      i++
    ) {
      keep.add(i);
    }
  });
  const lines: string[] = [];
  let previous = -1;
  for (const index of [...keep].sort((a, b) => a - b)) {
    if (previous !== -1 && index !== previous + 1) lines.push("…");
    const edit = edits[index] as Edit;
    lines.push(`${edit.kind} ${edit.line}`);
    previous = index;
  }
  return lines.join("\n");
}

function diffLines(a: string[], b: string[]): Edit[] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = table[i] as number[];
      const below = table[i + 1] as number[];
      row[j] =
        a[i] === b[j]
          ? (below[j + 1] as number) + 1
          : Math.max(below[j] as number, row[j + 1] as number);
    }
  }
  const edits: Edit[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const row = table[i] as number[];
    const below = table[i + 1] as number[];
    if (a[i] === b[j]) {
      edits.push({ kind: " ", line: a[i] as string });
      i++;
      j++;
    } else if ((below[j] as number) >= (row[j + 1] as number)) {
      edits.push({ kind: "-", line: a[i] as string });
      i++;
    } else {
      edits.push({ kind: "+", line: b[j] as string });
      j++;
    }
  }
  while (i < a.length) edits.push({ kind: "-", line: a[i++] as string });
  while (j < b.length) edits.push({ kind: "+", line: b[j++] as string });
  return edits;
}
