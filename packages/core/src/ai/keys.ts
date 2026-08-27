/**
 * Where BYOK keys come from: the environment first, then the OS keychain,
 * reached through the platform's own tool so a compiled dolly never needs a
 * native module. Ground rule 2 in docs/design/ai.md: keys live in those two
 * places and nowhere else, never in files dolly writes.
 */

import { PROVIDERS, type ProviderId } from "./providers";

export type KeySource = "environment" | "keychain";

export class KeychainUnavailableError extends Error {
  override name = "KeychainUnavailableError";

  constructor(provider: ProviderId, reason: string) {
    super(`${reason} Set ${PROVIDERS[provider].envVars[0]} in your environment instead.`);
  }
}

/** The key for a provider and where it came from, or null. The environment always wins. */
export async function findKey(
  provider: ProviderId,
): Promise<{ key: string; source: KeySource } | null> {
  for (const envVar of PROVIDERS[provider].envVars) {
    const value = process.env[envVar]?.trim();
    if (value) return { key: value, source: "environment" };
  }
  const stored = await keychainRead(provider);
  return stored ? { key: stored, source: "keychain" } : null;
}

/** Write a key to the OS keychain (service "dolly", account = provider), overwriting in place. */
export async function storeKey(provider: ProviderId, key: string): Promise<void> {
  switch (process.platform) {
    case "darwin": {
      // The command rides stdin of `security -i`, so the key never appears
      // in an argv another process could list.
      const result = await runTool(
        ["security", "-i"],
        `add-generic-password -U -s dolly -a ${provider} -w ${key}\n`,
      );
      if (!result) {
        throw new KeychainUnavailableError(provider, "The macOS security tool was not found.");
      }
      if (!result.ok) {
        throw new KeychainUnavailableError(
          provider,
          `The macOS keychain refused the write: ${result.stderr.trim() || "unknown error"}.`,
        );
      }
      return;
    }
    case "linux": {
      // secret-tool takes the secret on stdin by its own design.
      const result = await runTool(
        ["secret-tool", "store", "--label", `dolly (${provider})`, ...attrs(provider)],
        key,
      );
      if (!result) {
        throw new KeychainUnavailableError(
          provider,
          "secret-tool (libsecret) was not found on this machine.",
        );
      }
      if (!result.ok) {
        throw new KeychainUnavailableError(
          provider,
          `The keychain refused the write: ${result.stderr.trim() || "unknown error"}.`,
        );
      }
      return;
    }
    default:
      // Windows waits on a machine that can verify a DPAPI route (M9, with
      // the CI matrix). Refusal beats a plaintext fallback.
      throw new KeychainUnavailableError(
        provider,
        `dolly has no keychain support on ${process.platform} yet.`,
      );
  }
}

async function keychainRead(provider: ProviderId): Promise<string | null> {
  switch (process.platform) {
    case "darwin": {
      const result = await runTool([
        "security",
        "find-generic-password",
        "-s",
        "dolly",
        "-a",
        provider,
        "-w",
      ]);
      return result?.ok ? result.stdout.trim() || null : null;
    }
    case "linux": {
      const result = await runTool(["secret-tool", "lookup", ...attrs(provider)]);
      return result?.ok ? result.stdout.trim() || null : null;
    }
    default:
      return null;
  }
}

/** The lookup attributes both secret-tool verbs share. */
function attrs(provider: ProviderId): string[] {
  return ["service", "dolly", "account", provider];
}

interface ToolResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Run a platform tool; null means the tool is not on this machine. */
async function runTool(cmd: string[], stdin?: string): Promise<ToolResult | null> {
  const child = (() => {
    try {
      return Bun.spawn(cmd, {
        // Passed explicitly because Bun resolves the executable against the
        // launch-time PATH otherwise, ignoring changes made since.
        env: process.env,
        stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch {
      return null;
    }
  })();
  if (!child) return null;
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { ok: code === 0, stdout, stderr };
}
