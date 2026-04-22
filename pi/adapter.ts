/**
 * Frontier model adapter — standalone, testable core.
 *
 * No pi dependencies. Pure functions using only fetch and process.env.
 * Used by both the pi extension and any future integrations.
 */

// ── Configuration ──────────────────────────────────────────────────────────

import { ProxyAgent } from "undici";

export const DEFAULT_SYSTEM_PROMPT =
  "You are being consulted as a frontier advisory model by a local AI system " +
  "that handles most tasks independently. You are called only when the local " +
  "model has determined it needs capabilities beyond its own. " +
  "Be direct and substantive. " +
  "Do not repeat the question back. Do not pad with caveats. " +
  "The local model is technically competent -- treat it as a peer.";

export const MAX_TOKENS = 4096;

export const MODEL_PREFERENCE = [
  ["anthropic", "claude-opus-4-7"] as const,
  ["openai", "gpt-4.1"] as const,
] as const;

export type ProviderName = (typeof MODEL_PREFERENCE)[number][0];

export const PROVIDER_CONFIG: Record<ProviderName, {
  envKey: string;
  envBaseUrl: string;
  defaultBaseUrl: string;
}> = {
  anthropic: {
    envKey: "ANTHROPIC_API_KEY",
    envBaseUrl: "ANTHROPIC_BASE_URL",
    defaultBaseUrl: "https://api.anthropic.com",
  },
  openai: {
    envKey: "OPENAI_API_KEY",
    envBaseUrl: "OPENAI_BASE_URL",
    defaultBaseUrl: "https://api.openai.com",
  },
};

// ── Credential resolution ─────────────────────────────────────────────────

export type ApiKeyResolver = (provider: ProviderName) => { apiKey: string; baseUrl: string } | undefined | Promise<{ apiKey: string; baseUrl: string } | undefined>;

export function envKeyResolver(): ApiKeyResolver {
  return (provider: ProviderName) => {
    const cfg = PROVIDER_CONFIG[provider];
    const apiKey = process.env[cfg.envKey];
    if (!apiKey) return undefined;
    return {
      apiKey,
      baseUrl: process.env[cfg.envBaseUrl] ?? cfg.defaultBaseUrl,
    };
  };
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T>)?.then === "function";
}

export function getProviderCredentials(provider: ProviderName, resolver?: ApiKeyResolver): { apiKey: string; baseUrl: string } | undefined {
  const resolve = resolver ?? envKeyResolver();
  const result = resolve(provider);
  return isPromise(result) ? undefined : result;
}

export async function getProviderCredentialsAsync(provider: ProviderName, resolver?: ApiKeyResolver): Promise<{ apiKey: string; baseUrl: string } | undefined> {
  const resolve = resolver ?? envKeyResolver();
  return resolve(provider);
}

// ── Proxy support for fetch ────────────────────────────────────────────────

let _proxyDispatcher: ReturnType<typeof ProxyAgent> | undefined;

function getDispatcher(): typeof fetch | undefined {
  // Respect proxy env vars (http_proxy, https_proxy, HTTPS_PROXY, HTTP_PROXY)
  // Undici's fetch in Docker doesn't auto-respect these, so we wire it explicitly.
  const proxyUrl =
    process.env.https_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy ||
    process.env.HTTP_PROXY;

  if (!proxyUrl) return undefined;

  // Avoid creating a new dispatcher on every call — cache it
  if (!_proxyDispatcher) {
    try {
      _proxyDispatcher = new ProxyAgent({ uri: proxyUrl });
    } catch {
      // ProxyAgent construction can fail in some environments; fall through to plain fetch
      _proxyDispatcher = undefined;
    }
  }

  return _proxyDispatcher;
}

// ── HTTP clients ───────────────────────────────────────────────────────────

export interface ConsultResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export async function callAnthropic(
  model: string,
  question: string,
  context: string,
  maxTokens: number,
  systemPrompt: string,
  creds: { apiKey: string; baseUrl: string },
): Promise<ConsultResult> {
  const headers: Record<string, string> = {
    "x-api-key": creds.apiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  };

  const userContent = context
    ? `<advisory_context>\n${context}\n</advisory_context>\n\n<advisory_question>\n${question}\n</advisory_question>`
    : question;

  const body = JSON.stringify({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  const dispatcher = getDispatcher();
  const resp = await fetch(`${creds.baseUrl}/v1/messages`, {
    method: "POST",
    headers,
    body,
    dispatcher,
  });

  if (!resp.ok) {
    const bodyText = await resp.text();
    throw new Error(`Anthropic ${resp.status}: ${bodyText}`);
  }

  const data = await resp.json() as {
    content: Array<{ type: string; text?: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const text = data.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");

  return {
    text,
    inputTokens: data.usage.input_tokens,
    outputTokens: data.usage.output_tokens,
  };
}

export async function callOpenAI(
  model: string,
  question: string,
  context: string,
  maxTokens: number,
  systemPrompt: string,
  creds: { apiKey: string; baseUrl: string },
): Promise<ConsultResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.apiKey}`,
    "Content-Type": "application/json",
  };

  const msgs = [{ role: "system" as const, content: systemPrompt }];
  const userContent = context ? `Context:\n${context}\n\nQuestion:\n${question}` : question;
  msgs.push({ role: "user" as const, content: userContent });

  const body = JSON.stringify({ model, max_tokens: maxTokens, messages: msgs });

  const dispatcher = getDispatcher();
  const resp = await fetch(`${creds.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body,
    dispatcher,
  });

  if (!resp.ok) {
    const bodyText = await resp.text();
    throw new Error(`OpenAI ${resp.status}: ${bodyText}`);
  }

  const data = await resp.json() as {
    choices: Array<{ message: { content: string } }>;
    usage: { prompt_tokens: number; completion_tokens: number };
  };

  return {
    text: data.choices[0]?.message.content ?? "",
    inputTokens: data.usage.prompt_tokens,
    outputTokens: data.usage.completion_tokens,
  };
}

// ── Consult core logic ─────────────────────────────────────────────────────

export interface ConsultOptions {
  question: string;
  context?: string;
  systemPrompt?: string;
  signal?: AbortSignal;
  /** Custom key resolver (e.g. from pi's AuthStorage). Defaults to process.env. */
  apiKeyResolver?: ApiKeyResolver;
}

export interface ConsultResponse {
  response: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export async function consult({ question, context = "", systemPrompt, apiKeyResolver }: ConsultOptions): Promise<ConsultResponse> {
  const sysPrompt = systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  let lastError: unknown;

  const start = performance.now();

  for (const [provider, modelId] of MODEL_PREFERENCE) {
    const creds = await getProviderCredentialsAsync(provider as ProviderName, apiKeyResolver);
    if (!creds) continue;

    try {
      const result = await (provider === "anthropic"
        ? callAnthropic(modelId, question, context, MAX_TOKENS, sysPrompt, creds)
        : callOpenAI(modelId, question, context, MAX_TOKENS, sysPrompt, creds));

      const latencyMs = Math.round(performance.now() - start);

      return {
        response: result.text,
        provider,
        model: modelId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs,
      };
    } catch (e) {
      console.error(`[frontier-advisor] Provider ${provider}/${modelId} failed:`, e);
      lastError = e;
    }
  }

  if (lastError) {
    throw new Error(`All configured providers failed. Last error: ${lastError}`);
  }
  throw new Error(
    "No API key configured for any provider. Set ANTHROPIC_API_KEY and/or OPENAI_API_KEY in the environment.",
  );
}
