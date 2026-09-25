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

/** An email address names a person, never a convention. Bounded, so a crafted line cannot stall the scan. */
const EMAIL = /[\w.+-]{1,64}@[\w-]{1,63}\.[A-Za-z]{2,}/;

/** Files that hold credentials by convention; an example env file is the one exception. */
const CREDENTIAL_FILE =
  /(^|\/)(\.env(\..+)?|\.npmrc|\.pypirc|\.netrc|[^/]+\.(pem|key|p12|pfx)|id_(rsa|dsa|ecdsa|ed25519))$/;
const EXAMPLE_ENV = /\.env\.(example|sample|template)$/;

/** Bytes that look like a secret: a private key, a well-known token shape, or a password assignment. */
const SECRET_SHAPE =
  /-----BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|sk_(live|test)_[0-9A-Za-z]{8,}|gh[pousr]_[0-9A-Za-z]{20,}|glpat-[0-9A-Za-z_-]{10,}|xox[baprs]-[0-9A-Za-z-]{10,}|_authToken\s*=|(?<![A-Za-z0-9_])(password|passwd|secret|token|api[_-]?key)\s*[=:]\s*['"]?[^\s'"]{6,}/i;

/** Why a file must never enter a pattern, or undefined: a pattern travels, and a credential must not travel with it. */
export function credentialMarker(path: string, text: string): string | undefined {
  if (CREDENTIAL_FILE.test(path) && !EXAMPLE_ENV.test(path)) return "a credential file by name";
  if (SECRET_SHAPE.test(text)) return "what looks like a secret";
  return undefined;
}

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
