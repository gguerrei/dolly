/**
 * Gates every file capture passes before its bytes enter a pattern, shared
 * by the toolchain configs and the scaffold templates so a pattern can never
 * carry one machine's paths or bytes no text editor could open.
 */

/** Captured text must not embed the extracting machine's home directory. */
const MACHINE_PATH = /(\/home\/[^\s"']+|\/Users\/[^\s"']+|[A-Za-z]:\\Users\\)/;

export function hasMachinePath(text: string): boolean {
  return MACHINE_PATH.test(text);
}

/** An email address names a person, never a convention. */
const EMAIL = /[\w.+-]+@[\w-]+\.[A-Za-z]{2,}/;

/** Matches a token only as a whole word, so "cli" never matches "client". */
export function wholeWord(token: string): RegExp {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`, "g");
}

/**
 * Identity a template must never carry into an unrelated project: an author's
 * email, or the source project's own name surviving somewhere the placeholder
 * rewrite cannot reach: a repository URL, a homepage, a docstring. Anything
 * constant across siblings passes the agreement test by construction, and
 * identity is exactly the kind of thing that is constant, so this is the gate
 * that makes agreement safe rather than merely consistent.
 */
export function identityMarker(text: string, project: string | undefined): string | undefined {
  if (EMAIL.test(text)) return "an email address";
  if (project && wholeWord(project).test(text)) return `the source project's name ("${project}")`;
  return undefined;
}

const NUL = 0x00;
const REPLACEMENT = 0xfffd;

/** Binary content: a NUL byte, or the replacement char a failed decode leaves. */
export function isBinary(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (code === NUL || code === REPLACEMENT) return true;
  }
  return false;
}
