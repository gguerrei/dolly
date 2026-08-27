/**
 * The three BYOK adapters behind one interface, all plain fetch. Each
 * provider is one POST to one endpoint with one response shape to unwrap;
 * SDK dependency trees would buy nothing here and would weigh on the
 * compiled binary M9 promises. Design in docs/design/ai.md.
 */

export type ProviderId = "anthropic" | "openai" | "google";

export interface AiRequest {
  system?: string;
  prompt: string;
  maxTokens?: number;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  defaultModel: string;
  /** Environment variables consulted before the keychain, in order. */
  envVars: string[];
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    defaultModel: "claude-sonnet-5",
    envVars: ["ANTHROPIC_API_KEY"],
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    defaultModel: "gpt-5.1",
    envVars: ["OPENAI_API_KEY"],
  },
  google: {
    id: "google",
    label: "Google",
    defaultModel: "gemini-2.5-flash",
    envVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  },
};

export function isProviderId(value: string): value is ProviderId {
  return value in PROVIDERS;
}

/** A provider said no (or nothing). The message carries its words, never the key. */
export class AiProviderError extends Error {
  override name = "AiProviderError";

  constructor(provider: ProviderId, detail: string) {
    super(`${PROVIDERS[provider].label}: ${detail}`);
  }
}

const DEFAULT_MAX_TOKENS = 1024;
const TIMEOUT_MS = 60_000;

/** One completion round trip: the model's text, or an AiProviderError. */
export async function complete(
  provider: ProviderId,
  request: AiRequest,
  key: string,
  model: string,
): Promise<string> {
  const raw = await post(provider, request, key, model);
  const reply = unwrap(provider, raw);
  if (reply === undefined) {
    throw new AiProviderError(provider, "the response carried no text");
  }
  return reply;
}

/**
 * The cheapest proof a key works: the same wire call, demanding only a 2xx.
 * connect uses this so a mistyped key fails now, in the provider's words,
 * instead of later in the middle of a consumer.
 */
export async function verifyKey(provider: ProviderId, key: string, model: string): Promise<void> {
  await post(provider, { prompt: "Reply with the single word ok.", maxTokens: 16 }, key, model);
}

async function post(
  provider: ProviderId,
  request: AiRequest,
  key: string,
  model: string,
): Promise<string> {
  const { url, headers, body } = wireRequest(provider, request, key, model);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AiProviderError(provider, `request failed (${redact(detail, key)})`);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new AiProviderError(
      provider,
      `HTTP ${response.status}: ${redact(errorDetail(text), key)}`,
    );
  }
  return text;
}

function wireRequest(
  provider: ProviderId,
  request: AiRequest,
  key: string,
  model: string,
): { url: string; headers: Record<string, string>; body: unknown } {
  const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS;
  switch (provider) {
    case "anthropic":
      return {
        url: "https://api.anthropic.com/v1/messages",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: {
          model,
          max_tokens: maxTokens,
          ...(request.system ? { system: request.system } : {}),
          messages: [{ role: "user", content: request.prompt }],
        },
      };
    case "openai":
      return {
        url: "https://api.openai.com/v1/chat/completions",
        headers: { authorization: `Bearer ${key}` },
        body: {
          model,
          max_completion_tokens: maxTokens,
          messages: [
            ...(request.system ? [{ role: "system", content: request.system }] : []),
            { role: "user", content: request.prompt },
          ],
        },
      };
    case "google":
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        headers: { "x-goog-api-key": key },
        body: {
          ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
          contents: [{ role: "user", parts: [{ text: request.prompt }] }],
          generationConfig: { maxOutputTokens: maxTokens },
        },
      };
  }
}

function unwrap(provider: ProviderId, raw: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  switch (provider) {
    case "anthropic": {
      const body = parsed as { content?: Array<{ text?: unknown }> };
      const part = body.content?.find((p) => typeof p.text === "string");
      return part?.text as string | undefined;
    }
    case "openai": {
      const body = parsed as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = body.choices?.[0]?.message?.content;
      return typeof content === "string" ? content : undefined;
    }
    case "google": {
      const body = parsed as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
      };
      const part = body.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === "string");
      return part?.text as string | undefined;
    }
  }
}

/** All three providers wrap failures the same way: { error: { message } }. */
function errorDetail(raw: string): string {
  try {
    const body = JSON.parse(raw) as { error?: { message?: unknown } };
    if (typeof body.error?.message === "string") return body.error.message;
  } catch {
    // Not JSON, so the raw body is the best detail available.
  }
  return raw.slice(0, 300) || "empty response body";
}

/** Keys must never ride an error message, wherever the provider echoed one. */
function redact(detail: string, key: string): string {
  return key.length > 0 ? detail.split(key).join("[key]") : detail;
}
