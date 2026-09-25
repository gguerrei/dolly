/**
 * The engine's one way of asking git a question. Fit's checkpoint and
 * commit, and the two history facets ADR-0005 allows, all go through here,
 * so "git is missing" and "this is not a repository" mean one thing. The
 * repository may be someone else's, delivered with its .git directory, and
 * git runs programs its config names (a signature verifier, a filesystem
 * monitor, hooks); those three doors are shut on every call.
 */
const SAFE_CONFIG = [
  "-c",
  "log.showSignature=false",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.hooksPath=.git/no-hooks",
];

export async function runGit(
  root: string,
  ...args: string[]
): Promise<{ ok: boolean; out: string }> {
  try {
    const child = Bun.spawn(["git", ...SAFE_CONFIG, ...args], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { ok: code === 0, out: code === 0 ? stdout : stderr };
  } catch (cause) {
    // No git on the PATH reads like any other refusal: not ok, with the reason.
    return { ok: false, out: cause instanceof Error ? cause.message : String(cause) };
  }
}
