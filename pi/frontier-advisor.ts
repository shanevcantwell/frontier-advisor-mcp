/**
 * frontier-advisor — PI extension (single-file, self-contained)
 *
 * Gives the local model a tool for consulting frontier AI APIs.
 * All logic inlined so it runs standalone from ~/.pi/agent/extensions/.
 *
 * Resolves API keys from pi's AuthStorage (oauth or env var).
 */

import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// ── Configuration ────────────────────────────────────────────────────────────

const DEFAULT_SYSTEM_PROMPT =
  "You are being consulted as a frontier advisory model by a local AI system " +
  "that handles most tasks independently. You are called only when the local " +
  "model has determined it needs capabilities beyond its own. " +
  "Be direct, substantive, and efficient with tokens. " +
  "Do not repeat the question back. Do not pad with caveats. " +
  "The local model is technically competent -- treat it as a peer.";

const MAX_TOKENS = 4096;

const MODEL_PREFERENCE = [
  ["anthropic", "claude-opus-4-7"],
  ["openai", "gpt-4.1"],
] as const;

type ProviderName = "anthropic" | "openai";

const PROVIDER_CONFIG: Record<ProviderName, { envKey: string; envBaseUrl: string; defaultBaseUrl: string }> = {
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

// ── Credential resolution ────────────────────────────────────────────────────

type ApiKeyResolver = (provider: ProviderName) => { apiKey: string; baseUrl: string } | undefined | Promise<{ apiKey: string; baseUrl: string } | undefined>;

function envKeyResolver(): ApiKeyResolver {
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

async function getProviderCredentials(provider: ProviderName, resolver?: ApiKeyResolver): Promise<{ apiKey: string; baseUrl: string } | undefined> {
  const resolve = resolver ?? envKeyResolver();
  return resolve(provider);
}

// ── HTTP clients ─────────────────────────────────────────────────────────────

async function callAnthropic(
  model: string,
  question: string,
  context: string,
  maxTokens: number,
  systemPrompt: string,
  creds: { apiKey: string; baseUrl: string },
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
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

  const resp = await fetch(`${creds.baseUrl}/v1/messages`, {
    method: "POST",
    headers,
    body,
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

async function callOpenAI(
  model: string,
  question: string,
  context: string,
  maxTokens: number,
  systemPrompt: string,
  creds: { apiKey: string; baseUrl: string },
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.apiKey}`,
    "Content-Type": "application/json",
  };

  const msgs = [{ role: "system" as const, content: systemPrompt }];
  const userContent = context ? `Context:\n${context}\n\nQuestion:\n${question}` : question;
  msgs.push({ role: "user" as const, content: userContent });

  const body = JSON.stringify({ model, max_tokens: maxTokens, messages: msgs });

  const resp = await fetch(`${creds.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body,
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

// ── Consult core logic ───────────────────────────────────────────────────────

async function consult(question: string, context: string, systemPrompt: string | undefined, apiKeyResolver?: ApiKeyResolver): Promise<{
  response: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  const sysPrompt = systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  let lastError: unknown;

  const start = performance.now();

  for (const [provider, modelId] of MODEL_PREFERENCE) {
    const creds = await getProviderCredentials(provider as ProviderName, apiKeyResolver);
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

  throw new Error(`No provider available. Last error: ${lastError}`);
}

// ── Tool definition ──────────────────────────────────────────────────────────

const CONSULT_TOOL_DEFINITION = {
  name: "consult_advisor",
  label: "Consult Advisor",
  description:
    "Consult a frontier AI model for advisory input. " +
    "Use when local capabilities are insufficient — " +
    "complex reasoning, architecture decisions, novel synthesis, " +
    "or factual verification beyond training data. " +
    "Frame the question precisely.",
  promptSnippet:
    "Consult frontier models (Sonnet 4.5 / GPT-4.1) for complex reasoning and advisory input",
  promptGuidelines: [
    "Use for complex reasoning, architecture decisions, or novel synthesis beyond local model capabilities",
    "Frame the question precisely; include only necessary context",
    "Local model is technically competent — the frontier model treats it as a peer",
  ],
  parameters: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The question to ask the frontier model. Be precise.",
      },
      context: {
        type: "string",
        description: "Supporting context the frontier model needs. Only what is necessary.",
      },
      system_prompt: {
        type: "string",
        description: "Override the default advisory system prompt.",
      },
    },
    required: ["question"],
  },
};

// ── Extension entry point ────────────────────────────────────────────────────

/** Build an ApiKeyResolver that reads from pi's AuthStorage.
 *
 * AuthStorage.getApiKeyForProvider() may return OAuth tokens (sk-ant-oat01)
 * which work with Claude's web API but NOT with the Messages API.
 * For Anthropic we need a real API key (sk-ant-api03). We check env vars
 * for that; for OpenAI bearer tokens work fine with OAuth tokens.
 */
function buildAuthStorageResolver(ctx: ExtensionContext): ApiKeyResolver {
  return async (provider) => {
    try {
      const envKey = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
      const envUrlKey = provider === "anthropic" ? "ANTHROPIC_BASE_URL" : "OPENAI_BASE_URL";
      const envDefault = provider === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com";

      // First check env var for a real API key (works with both providers)
      const envApiKey = process.env[envKey];
      if (envApiKey) {
        return {
          apiKey: envApiKey,
          baseUrl: process.env[envUrlKey] ?? envDefault,
        };
      }

      // Fall back to pi's AuthStorage (handles OAuth tokens for OpenAI,
      // and API keys stored in auth.json for providers without OAuth)
      const storedKey = await ctx.modelRegistry.getApiKeyForProvider(provider);
      if (!storedKey) return undefined;

      // Skip OAuth tokens for Anthropic — they are web app tokens (sk-ant-oat01)
      // not Messages API keys (sk-ant-api03). Only use env vars for Anthropic.
      if (provider === "anthropic" && storedKey.startsWith("sk-ant-oat")) {
        return undefined;
      }

      return {
        apiKey: storedKey,
        baseUrl: process.env[envUrlKey] ?? envDefault,
      };
    } catch {
      return undefined;
    }
  };
}

export default function frontierAdvisorExtension(pi: ExtensionAPI) {
  pi.registerTool({
    ...CONSULT_TOOL_DEFINITION,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      // Build key resolver from pi's auth storage (oauth or env var)
      const resolver = buildAuthStorageResolver(ctx);

      try {
        const result = await consult(
          params.question,
          params.context ?? "",
          params.system_prompt || undefined,
          resolver,
        );

        return {
          content: [{ type: "text", text: JSON.stringify({
            status: "ok",
            advisory_response: result.response,
            metadata: {
              provider: result.provider,
              model: result.model,
              input_tokens: result.inputTokens,
              output_tokens: result.outputTokens,
              latency_ms: result.latencyMs,
            },
          }, null, 2) }],
          details: {
            provider: result.provider,
            model: result.model,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            latencyMs: result.latencyMs,
          },
        } as AgentToolResult;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: JSON.stringify({ status: "error", detail: msg }, null, 2) }],
          details: { error: msg },
        } as AgentToolResult;
      }
    },
  });
}
