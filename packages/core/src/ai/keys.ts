/**
 * Where BYOK keys come from: the environment first, then the OS keychain,
 * reached through the platform's own tool so a compiled dolly never needs a
 * native module. The layer's second rule: keys live in those two
 * places and nowhere else, never in files dolly writes.
 */

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dollyHome } from "../store";
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
    case "win32": {
      // DPAPI through PowerShell: the key rides stdin and lands sealed for
      // this Windows user alone, in dolly's own home. Never plaintext.
      await mkdir(dirname(dpapiFile(provider)), { recursive: true });
      const result = await runTool(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", dpapiSeal(dpapiFile(provider))],
        key,
      );
      if (!result) {
        throw new KeychainUnavailableError(provider, "PowerShell was not found on this machine.");
      }
      if (!result.ok) {
        throw new KeychainUnavailableError(
          provider,
          `DPAPI refused the write: ${result.stderr.trim() || "unknown error"}.`,
        );
      }
      return;
    }
    default:
      throw new KeychainUnavailableError(
        provider,
        `dolly has no keychain support on ${process.platform}.`,
      );
  }
}

/** Where a sealed key lives on Windows: beside the pattern store, one file per provider. */
function dpapiFile(provider: ProviderId): string {
  return join(dollyHome(), "keys", `${provider}.dpapi`);
}

/** PowerShell that seals stdin for the current user into the file; a quote in the path is doubled. */
function dpapiSeal(file: string): string {
  return [
    "Add-Type -AssemblyName System.Security",
    "$key = [Console]::In.ReadToEnd().Trim()",
    "$bytes = [Text.Encoding]::UTF8.GetBytes($key)",
    "$sealed = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser')",
    `[IO.File]::WriteAllBytes('${file.replaceAll("'", "''")}', $sealed)`,
  ].join("; ");
}

/** PowerShell that unseals the file for the current user and prints the key. */
function dpapiOpen(file: string): string {
  return [
    "Add-Type -AssemblyName System.Security",
    `$sealed = [IO.File]::ReadAllBytes('${file.replaceAll("'", "''")}')`,
    "$bytes = [Security.Cryptography.ProtectedData]::Unprotect($sealed, $null, 'CurrentUser')",
    "[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))",
  ].join("; ");
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
    case "win32": {
      if (!(await Bun.file(dpapiFile(provider)).exists())) return null;
      const result = await runTool([
        "powershell",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        dpapiOpen(dpapiFile(provider)),
      ]);
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
