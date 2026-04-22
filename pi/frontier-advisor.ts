/**
 * frontier-advisor — PI extension
 *
 * Gives the local model a tool for consulting frontier AI APIs.
 * Ported from the MCP server (mcp/src/) to run natively inside pi.
 *
 * - Provider fallback: Anthropic (Sonnet 4.5) → OpenAI (GPT-4.1)
 * - Credentials from environment variables or pi's AuthStorage
 * - Stateless: routes and returns, governance handled by the scaffold
 *
 * Usage: place in ~/.pi/agent/extensions/ or .pi/extensions/
 */

import { Type } from "@sinclair/typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// ── Configuration ──────────────────────────────────────────────────────────

const DEFAULT_SYSTEM_PROMPT =
  "You are being consulted as a frontier advisory model by a local AI system " +
  "that handles most tasks independently. You are called only when the local " +
  "model has determined it needs capabilities beyond its own. " +
  "Be direct, substantive, and efficient with tokens. " +
  "Do not repeat the question back. Do not pad with caveats. " +
  "The local model is technically competent -- treat it as a peer.";

const MAX_TOKENS = 4096;

const MODEL_PREFERENCE = [
  ["anthropic", "claude-sonnet-4-5-20250929"] as const,
  ["openai", "gpt-4.1"] as const,
] as const;

type ProviderName = (typeof MODEL_PREFERENCE)[number][0];

const PROVIDER_CONFIG: Record<ProviderName, {
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

function getProviderCredentials(provider: ProviderName): { apiKey: string; baseUrl: string } | undefined {
  const cfg = PROVIDER_CONFIG[provider];
  const apiKey = process.env[cfg.envKey];
  if (!apiKey) return undefined;
  return {
    apiKey,
    baseUrl: process.env[cfg.envBaseUrl] ?? cfg.defaultBaseUrl,
  };
}

// ── HTTP clients ───────────────────────────────────────────────────────────

interface ConsultResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

async function callAnthropic(
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
): Promise<ConsultResult> {
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

// ── Consult core logic ─────────────────────────────────────────────────────

interface ConsultOptions {
  question: string;
  context?: string;
  systemPrompt?: string;
  signal?: AbortSignal;
}

async function consult({ question, context = "", systemPrompt }: ConsultOptions): Promise<{
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
    const creds = getProviderCredentials(provider as ProviderName);
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

// ── Pi tool registration ───────────────────────────────────────────────────

const CONSULT_PARAMS = Type.Object({
  question: Type.String({ description: "The question to ask the frontier model. Be precise." }),
  context: Type.Optional(Type.String({ description: "Supporting context the frontier model needs. Only what is necessary." })),
  system_prompt: Type.Optional(Type.String({ description: "Override the default advisory system prompt." })),
});

export default function frontierAdvisorExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "consult_advisor",
    label: "Consult Advisor",
    description:
      "Consult a frontier AI model for advisory input. " +
      "Use when local capabilities are insufficient — " +
      "complex reasoning, architecture decisions, novel synthesis, " +
      "or factual verification beyond training data. " +
      "Frame the question precisely.",
    promptSnippet: "Consult frontier models (Sonnet 4.5 / GPT-4.1) for complex reasoning and advisory input",
    promptGuidelines: [
      "Use for complex reasoning, architecture decisions, or novel synthesis beyond local model capabilities",
      "Frame the question precisely; include only necessary context",
      "Local model is technically competent — the frontier model treats it as a peer",
    ],
    parameters: CONSULT_PARAMS,
    async execute(_toolCallId, params, signal) {
      const question = params.question;
      const context = params.context ?? "";
      const systemPrompt = params.system_prompt || undefined;

      try {
        const result = await consult({ question, context, systemPrompt, signal: signal ?? undefined });

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
