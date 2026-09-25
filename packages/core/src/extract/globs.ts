/**
 * Segment-level glob matching over the inventory's directory list: `*` and
 * `**` only, which is all real workspace globs need.
 */
export function expandGlobs(globs: string[], dirs: string[]): string[] {
  const includes = globs.filter((g) => !g.startsWith("!"));
  const excludes = globs.filter((g) => g.startsWith("!")).map((g) => g.slice(1));
  return dirs
    .filter(
      (dir) =>
        includes.some((g) => matchesGlob(g, dir)) && !excludes.some((g) => matchesGlob(g, dir)),
    )
    .sort();
}

/** Whether one segment glob (`*`, `**`) matches a path; the marker's ignore list uses it too. */
export function matchesGlob(glob: string, dir: string): boolean {
  // `a/**/**/b` means `a/**/b`; collapsing keeps the match linear in the path's length.
  const gs = glob
    .replace(/\/$/, "")
    .replace(/(\/?\*\*)+(\/\*\*)+/g, "$1")
    .split("/");
  const ds = dir.split("/");
  const match = (gi: number, di: number): boolean => {
    if (gi === gs.length) return di === ds.length;
    if (gs[gi] === "**") return match(gi + 1, di) || (di < ds.length && match(gi, di + 1));
    if (di === ds.length) return false;
    const pattern = new RegExp(
      `^${(gs[gi] as string).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`,
    );
    return pattern.test(ds[di] as string) && match(gi + 1, di + 1);
  };
  return match(0, 0);
}
