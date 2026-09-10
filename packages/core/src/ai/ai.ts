/**
 * The AI layer's switch. The active provider and model live in
 * <dollyHome>/ai.json, and the file's absence is "off". Consumers ask
 * activeAi() and get null when the layer is off, which is why no
 * deterministic path ever needs this module (ground rule 1 in
 * docs/design/ai.md). No process state: the CLI and the daemon agree
 * because both read the file fresh.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dollyHome } from "../store";
import { findKey, type KeySource, storeKey } from "./keys";
import {
  type AiRequest,
  complete,
  isProviderId,
  PROVIDERS,
  type ProviderId,
  verifyKey,
} from "./providers";

const SETTINGS_FILE = "ai.json";

export interface AiStatus {
  /** null when the layer is off. */
  provider: ProviderId | null;
  /** Resolved: the explicit choice, or the provider's default. */
  model: string | null;
  /** "missing" when a provider is selected but no key can be found for it. */
  keySource: KeySource | "missing" | null;
}

/** What a consumer holds while AI is on: identity plus one door. */
export interface AiClient {
  provider: ProviderId;
  model: string;
  complete(request: AiRequest): Promise<string>;
}

export async function aiStatus(): Promise<AiStatus> {
  const settings = await readSettings();
  if (!settings) return { provider: null, model: null, keySource: null };
  const found = await findKey(settings.provider);
  return {
    provider: settings.provider,
    model: settings.model ?? PROVIDERS[settings.provider].defaultModel,
    keySource: found?.source ?? "missing",
  };
}

/**
 * The status plus one live round trip on the active key, so a revoked key
 * shows here instead of inside a consumer. `error` carries the provider's
 * refusal in its words; it is absent when the layer is off or has no key.
 */
export async function verifyAi(): Promise<{ status: AiStatus; error?: string }> {
  const status = await aiStatus();
  if (!status.provider || !status.model || status.keySource === "missing") return { status };
  const found = await findKey(status.provider);
  if (!found) return { status };
  try {
    await verifyKey(status.provider, found.key, status.model);
    return { status };
  } catch (error) {
    return { status, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The caller's mistake, not the provider's: an unknown provider, a malformed key, a selection without a key. */
export class AiUsageError extends Error {
  override name = "AiUsageError";
}

/** Every provider as the settings surface lists it: label, default model, and where its key lives. */
export interface AiProviderStatus {
  id: ProviderId;
  label: string;
  defaultModel: string;
  /** "missing" when no key can be found for it. */
  keySource: KeySource | "missing";
  /** The environment variable that supplies a key, the first of the ones honored. */
  envVar: string;
}

export async function aiProviders(): Promise<AiProviderStatus[]> {
  return Promise.all(
    (Object.keys(PROVIDERS) as ProviderId[]).map(async (id) => ({
      id,
      label: PROVIDERS[id].label,
      defaultModel: PROVIDERS[id].defaultModel,
      keySource: (await findKey(id))?.source ?? "missing",
      envVar: PROVIDERS[id].envVars[0] as string,
    })),
  );
}

/**
 * Verify a key with a live round trip, store it in the OS keychain, and
 * select the provider when nothing is selected yet. Verification comes
 * first: a mistyped key must fail here, in the provider's words, not weeks
 * later inside a consumer.
 */
export async function connectAi(providerArg: string, key: string): Promise<AiStatus> {
  const provider = parseProvider(providerArg);
  const trimmed = key.trim();
  if (!trimmed || /[\s"']/.test(trimmed)) {
    throw new AiUsageError(
      "That does not look like an API key (empty, or carrying whitespace or quotes).",
    );
  }
  await verifyKey(provider, trimmed, PROVIDERS[provider].defaultModel);
  await storeKey(provider, trimmed);
  if (!(await readSettings())) await writeSettings({ provider });
  return aiStatus();
}

/** Pick the active provider (and optionally a model). Refuses without a key. */
export async function useAi(providerArg: string, model?: string): Promise<AiStatus> {
  const provider = parseProvider(providerArg);
  const found = await findKey(provider);
  if (!found) {
    throw new AiUsageError(
      `No key for ${PROVIDERS[provider].label}. Run \`dolly ai connect ${provider}\` or set ${PROVIDERS[provider].envVars[0]}.`,
    );
  }
  // A blank model means the provider's default, whichever door it came through.
  const chosen = model?.trim() || undefined;
  await writeSettings({ provider, model: chosen });
  return {
    provider,
    model: chosen ?? PROVIDERS[provider].defaultModel,
    keySource: found.source,
  };
}

/** Forget the selection. Stored keys stay in the keychain. */
export async function aiOff(): Promise<void> {
  await rm(settingsPath(), { force: true });
}

/**
 * The one door consumers use: a ready client, or null when the layer is
 * off. A selection whose key has vanished also reads as off rather than an
 * error, so the deterministic path proceeds untouched either way.
 */
export async function activeAi(): Promise<AiClient | null> {
  const settings = await readSettings();
  if (!settings) return null;
  const found = await findKey(settings.provider);
  if (!found) return null;
  const provider = settings.provider;
  const model = settings.model ?? PROVIDERS[provider].defaultModel;
  return {
    provider,
    model,
    complete: (request) => complete(provider, request, found.key, model),
  };
}

interface AiSettings {
  provider: ProviderId;
  model?: string;
}

/** The file is dolly's own and rewritten whole by `use`; anything unreadable reads as off. */
async function readSettings(): Promise<AiSettings | null> {
  let text: string;
  try {
    text = await readFile(settingsPath(), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as { provider?: unknown; model?: unknown };
    if (typeof parsed.provider === "string" && isProviderId(parsed.provider)) {
      return {
        provider: parsed.provider,
        ...(typeof parsed.model === "string" ? { model: parsed.model } : {}),
      };
    }
  } catch {
    // Fall through: off.
  }
  return null;
}

async function writeSettings(settings: AiSettings): Promise<void> {
  await mkdir(dollyHome(), { recursive: true });
  await writeFile(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`);
}

function settingsPath(): string {
  return join(dollyHome(), SETTINGS_FILE);
}

function parseProvider(value: string): ProviderId {
  if (isProviderId(value)) return value;
  throw new AiUsageError(`Unknown provider "${value}". Pick one of: anthropic, openai, google.`);
}
