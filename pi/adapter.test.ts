/**
 * Tests for frontier-advisor adapter (standalone core logic).
 *
 * Tests the adapter layer that works independently of the pi extension system.
 * Uses mocked fetch — no network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  consult,
  callAnthropic,
  callOpenAI,
  getProviderCredentials,
  getProviderCredentialsAsync,
  envKeyResolver,
  ApiKeyResolver,
  DEFAULT_SYSTEM_PROMPT,
  MAX_TOKENS,
  MODEL_PREFERENCE,
  PROVIDER_CONFIG,
} from "./adapter.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function createMockFetch(response: Record<string, unknown>, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status,
    json: () => Promise.resolve(response),
    text: () => Promise.resolve(JSON.stringify(response)),
  });
}

function createErrorMockFetch(status: number, body: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  });
}

// ── Config tests ───────────────────────────────────────────────────────────

describe("Configuration", () => {
  it("has at least one model in preference", () => {
    expect(MODEL_PREFERENCE.length).toBeGreaterThan(0);
  });

  it("includes both providers", () => {
    const providers = MODEL_PREFERENCE.map(([p]) => p);
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
  });

  it("has positive MAX_TOKENS", () => {
    expect(MAX_TOKENS).toBeGreaterThan(0);
  });

  it("has non-empty system prompt", () => {
    expect(DEFAULT_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it("both providers have required config keys", () => {
    for (const [provider, cfg] of Object.entries(PROVIDER_CONFIG)) {
      expect(cfg).toHaveProperty("envKey");
      expect(cfg).toHaveProperty("envBaseUrl");
      expect(cfg).toHaveProperty("defaultBaseUrl");
    }
  });

  it("defaults use correct public URLs", () => {
    expect(PROVIDER_CONFIG.anthropic.defaultBaseUrl).toBe("https://api.anthropic.com");
    expect(PROVIDER_CONFIG.openai.defaultBaseUrl).toBe("https://api.openai.com");
  });
});

// ── Credential resolution ──────────────────────────────────────────────────

describe("envKeyResolver", () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.OPENAI_BASE_URL;
  });

  it("returns undefined when key is missing", () => {
    const resolver = envKeyResolver();
    expect(resolver("anthropic")).toBeUndefined();
  });

  it("returns creds when key is present", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const resolver = envKeyResolver();
    const result = resolver("anthropic");
    expect(result).toBeDefined();
    expect(result?.apiKey).toBe("sk-test");
  });

  it("uses custom base URL when set", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_BASE_URL = "http://localhost:8080";
    const resolver = envKeyResolver();
    const result = resolver("openai");
    expect(result?.baseUrl).toBe("http://localhost:8080");
  });

  it("uses default base URL when not overridden", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const resolver = envKeyResolver();
    const result = resolver("anthropic");
    expect(result?.baseUrl).toBe("https://api.anthropic.com");
  });

  it("works for both providers independently", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.OPENAI_API_KEY = "sk-oai-test";

    const resolver = envKeyResolver();
    const ant = resolver("anthropic");
    const oai = resolver("openai");

    expect(ant?.apiKey).toBe("sk-ant-test");
    expect(oai?.apiKey).toBe("sk-oai-test");
  });
});

describe("getProviderCredentials", () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.OPENAI_BASE_URL;
  });

  it("uses envKeyResolver by default", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const result = getProviderCredentials("anthropic");
    expect(result?.apiKey).toBe("sk-test");
  });

  it("uses custom resolver when provided", () => {
    const mockResolver: ApiKeyResolver = (provider) => {
      if (provider === "anthropic") return { apiKey: "mocked-key", baseUrl: "https://mock.api" };
      return undefined;
    };
    const result = getProviderCredentials("anthropic", mockResolver);
    expect(result?.apiKey).toBe("mocked-key");
    expect(result?.baseUrl).toBe("https://mock.api");
  });

  it("async resolver works with getProviderCredentialsAsync", async () => {
    const mockResolver: ApiKeyResolver = async (provider) => {
      if (provider === "anthropic") return { apiKey: "async-key", baseUrl: "https://async.api" };
      return undefined;
    };
    const result = await getProviderCredentialsAsync("anthropic", mockResolver);
    expect(result?.apiKey).toBe("async-key");
    expect(result?.baseUrl).toBe("https://async.api");
  });
});

// ── Anthropic client ───────────────────────────────────────────────────────

describe("callAnthropic", () => {
  it("sends correct request to Anthropic API", async () => {
    const mockFetch = createMockFetch({
      content: [{ type: "text", text: "Advisory response." }],
      usage: { input_tokens: 10, output_tokens: 8 },
    });

    vi.stubGlobal("fetch", mockFetch);

    const result = await callAnthropic(
      "claude-opus-4-7",
      "What is 2+2?",
      "",
      MAX_TOKENS,
      DEFAULT_SYSTEM_PROMPT,
      { apiKey: "sk-ant", baseUrl: "https://api.anthropic.com" },
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body as string);
    expect(body.model).toBe("claude-opus-4-7");
    expect(body.max_tokens).toBe(MAX_TOKENS);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content).toBe("What is 2+2?");

    expect(result.text).toBe("Advisory response.");
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(8);

    vi.unstubAllGlobals();
  });

  it("wraps question and context in XML tags", async () => {
    const mockFetch = createMockFetch({
      content: [{ type: "text", text: "Use pytest." }],
      usage: { input_tokens: 15, output_tokens: 3 },
    });

    vi.stubGlobal("fetch", mockFetch);

    await callAnthropic(
      "test-model",
      "pytest or unittest?",
      "The user is working on a Python project.",
      MAX_TOKENS,
      DEFAULT_SYSTEM_PROMPT,
      { apiKey: "sk-ant", baseUrl: "https://api.anthropic.com" },
    );

    const body = JSON.parse((mockFetch.mock.calls[0][1] as any).body);
    const content = body.messages[0].content;
    expect(content).toContain("<advisory_context>");
    expect(content).toContain("<advisory_question>");
    expect(content).toContain("The user is working on a Python project.");
    expect(content).toContain("pytest or unittest?");

    vi.unstubAllGlobals();
  });

  it("concatenates only text blocks, ignoring non-text", async () => {
    const mockFetch = createMockFetch({
      content: [
        { type: "text", text: "First part of " },
        { type: "tool_use", id: "tool1", name: "calculator" },
        { type: "text", text: "second part." },
      ],
      usage: { input_tokens: 5, output_tokens: 10 },
    });

    vi.stubGlobal("fetch", mockFetch);

    const result = await callAnthropic(
      "test-model",
      "test",
      "",
      MAX_TOKENS,
      DEFAULT_SYSTEM_PROMPT,
      { apiKey: "sk-ant", baseUrl: "https://api.anthropic.com" },
    );

    expect(result.text).toBe("First part of second part.");

    vi.unstubAllGlobals();
  });

  it("throws on HTTP error", async () => {
    const mockFetch = createErrorMockFetch(401, 'Invalid API key');
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      callAnthropic("test", "q", "", MAX_TOKENS, "sys", { apiKey: "bad", baseUrl: "https://api.anthropic.com" }),
    ).rejects.toThrow("Anthropic 401: Invalid API key");

    vi.unstubAllGlobals();
  });

  it("passes custom system prompt", async () => {
    const mockFetch = createMockFetch({
      content: [{ type: "text", text: "OK" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    vi.stubGlobal("fetch", mockFetch);

    await callAnthropic(
      "test", "q", "", MAX_TOKENS, "You are a helpful coding assistant.",
      { apiKey: "sk", baseUrl: "https://api.anthropic.com" },
    );

    const body = JSON.parse((mockFetch.mock.calls[0][1] as any).body);
    expect(body.system).toBe("You are a helpful coding assistant.");

    vi.unstubAllGlobals();
  });
});

// ── OpenAI client ──────────────────────────────────────────────────────────

describe("callOpenAI", () => {
  it("sends correct request to OpenAI API", async () => {
    const mockFetch = createMockFetch({
      choices: [{ message: { content: "OpenAI advisory response." } }],
      usage: { prompt_tokens: 12, completion_tokens: 6 },
    });

    vi.stubGlobal("fetch", mockFetch);

    const result = await callOpenAI(
      "gpt-4.1",
      "What is the capital of France?",
      "",
      MAX_TOKENS,
      DEFAULT_SYSTEM_PROMPT,
      { apiKey: "sk-oai", baseUrl: "https://api.openai.com" },
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body as string);
    expect(body.model).toBe("gpt-4.1");
    expect(body.max_tokens).toBe(MAX_TOKENS);
    expect(body.messages.length).toBe(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");

    expect(result.text).toBe("OpenAI advisory response.");
    expect(result.inputTokens).toBe(12);
    expect(result.outputTokens).toBe(6);

    vi.unstubAllGlobals();
  });

  it("wraps context and question for OpenAI", async () => {
    const mockFetch = createMockFetch({
      choices: [{ message: { content: "Use Zustand." } }],
      usage: { prompt_tokens: 20, completion_tokens: 3 },
    });

    vi.stubGlobal("fetch", mockFetch);

    await callOpenAI(
      "gpt-4.1",
      "Redux or Zustand?",
      "Project uses React and TypeScript.",
      MAX_TOKENS,
      DEFAULT_SYSTEM_PROMPT,
      { apiKey: "sk", baseUrl: "https://api.openai.com" },
    );

    const body = JSON.parse((mockFetch.mock.calls[0][1] as any).body);
    const userContent = body.messages[1].content;
    expect(userContent).toContain("Context:");
    expect(userContent).toContain("Project uses React and TypeScript.");
    expect(userContent).toContain("Redux or Zustand?");

    vi.unstubAllGlobals();
  });

  it("uses custom base URL", async () => {
    const mockFetch = createMockFetch({
      choices: [{ message: { content: "Local proxy response." } }],
      usage: { prompt_tokens: 5, completion_tokens: 5 },
    });

    vi.stubGlobal("fetch", mockFetch);

    const result = await callOpenAI(
      "gpt-4.1",
      "test",
      "",
      MAX_TOKENS,
      DEFAULT_SYSTEM_PROMPT,
      { apiKey: "sk", baseUrl: "http://localhost:8080" },
    );

    expect(mockFetch).toHaveBeenCalledWith("http://localhost:8080/v1/chat/completions", expect.anything());
    expect(result.text).toBe("Local proxy response.");

    vi.unstubAllGlobals();
  });

  it("throws on HTTP error", async () => {
    const mockFetch = createErrorMockFetch(429, "Rate limit exceeded");
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      callOpenAI("gpt-4.1", "q", "", MAX_TOKENS, "sys", { apiKey: "sk", baseUrl: "https://api.openai.com" }),
    ).rejects.toThrow("OpenAI 429: Rate limit exceeded");

    vi.unstubAllGlobals();
  });

  it("passes custom system prompt", async () => {
    const mockFetch = createMockFetch({
      choices: [{ message: { content: "OK" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    vi.stubGlobal("fetch", mockFetch);

    await callOpenAI(
      "gpt-4.1", "q", "", MAX_TOKENS, "You are sarcastic.",
      { apiKey: "sk", baseUrl: "https://api.openai.com" },
    );

    const body = JSON.parse((mockFetch.mock.calls[0][1] as any).body);
    expect(body.messages[0].content).toBe("You are sarcastic.");

    vi.unstubAllGlobals();
  });
});

// ── Consult (provider fallback) ────────────────────────────────────────────

describe("consult", () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.OPENAI_BASE_URL;
  });

  it("uses Anthropic when both keys are present", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant";
    process.env.OPENAI_API_KEY = "sk-oai";

    const anthropicFetch = createMockFetch({
      content: [{ type: "text", text: "Anthropic response." }],
      usage: { input_tokens: 5, output_tokens: 3 },
    });
    const openaiFetch = createMockFetch({
      choices: [{ message: { content: "OpenAI response." } }],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    });

    vi.stubGlobal("fetch", (url: string) =>
      url.includes("anthropic") ? anthropicFetch(url) : openaiFetch(url)
    );

    const result = await consult({ question: "test" });

    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-opus-4-7");
    expect(result.response).toBe("Anthropic response.");
    expect(result.inputTokens).toBe(5);
    expect(result.outputTokens).toBe(3);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    vi.unstubAllGlobals();
  });

  it("falls back to OpenAI when Anthropic fails", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant";
    process.env.OPENAI_API_KEY = "sk-oai";

    const anthropicFetch = createErrorMockFetch(500, "Internal Server Error");
    const openaiFetch = createMockFetch({
      choices: [{ message: { content: "Fallback response." } }],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    });

    vi.stubGlobal("fetch", (url: string) =>
      url.includes("anthropic") ? anthropicFetch(url) : openaiFetch(url)
    );

    const result = await consult({ question: "test" });

    expect(result.provider).toBe("openai");
    expect(result.response).toBe("Fallback response.");

    vi.unstubAllGlobals();
  });

  it("falls back to OpenAI when Anthropic key is missing", async () => {
    process.env.OPENAI_API_KEY = "sk-oai";

    const openaiFetch = createMockFetch({
      choices: [{ message: { content: "OpenAI only." } }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    });

    vi.stubGlobal("fetch", openaiFetch);

    const result = await consult({ question: "test" });

    expect(result.provider).toBe("openai");

    vi.unstubAllGlobals();
  });

  it("throws when no provider keys are available", async () => {
    await expect(consult({ question: "test" })).rejects.toThrow(
      "No API key configured",
    );
  });

  it("throws when all providers fail", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant";
    process.env.OPENAI_API_KEY = "sk-oai";

    vi.stubGlobal("fetch", createErrorMockFetch(503, "Service Unavailable"));

    await expect(consult({ question: "test" })).rejects.toThrow(
      "All configured providers failed",
    );

    vi.unstubAllGlobals();
  });

  it("passes context to Anthropic provider", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant";

    let capturedBody: any = null;
    const mockFetch = createMockFetch({
      content: [{ type: "text", text: "OK" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    vi.stubGlobal("fetch", (url: string, options: any) => {
      if (url.includes("anthropic")) {
        capturedBody = JSON.parse(options.body);
        return mockFetch(url, options);
      }
      return Promise.resolve({
        ok: false, status: 401, text: () => Promise.resolve("No key"),
      });
    });

    await consult({
      question: "Python or Rust?",
      context: "The project is a data pipeline.",
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody.messages[0].content).toContain("<advisory_context>");
    expect(capturedBody.messages[0].content).toContain("The project is a data pipeline.");
    expect(capturedBody.messages[0].content).toContain("Python or Rust?");

    vi.unstubAllGlobals();
  });

  it("passes context to OpenAI provider", async () => {
    process.env.OPENAI_API_KEY = "sk-oai";

    let capturedBody: any = null;
    const mockFetch = createMockFetch({
      choices: [{ message: { content: "OK" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    vi.stubGlobal("fetch", (url: string, options: any) => {
      if (url.includes("openai")) {
        capturedBody = JSON.parse(options.body);
        return mockFetch(url, options);
      }
      return Promise.resolve({
        ok: false, status: 401, text: () => Promise.resolve("No key"),
      });
    });

    await consult({
      question: "Python or Rust?",
      context: "The project is a data pipeline.",
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody.messages[1].content).toContain("Context:");
    expect(capturedBody.messages[1].content).toContain("data pipeline");
    expect(capturedBody.messages[1].content).toContain("Python or Rust?");

    vi.unstubAllGlobals();
  });

  it("uses custom system prompt", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant";

    let capturedBody: any = null;
    const mockFetch = createMockFetch({
      content: [{ type: "text", text: "OK" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    vi.stubGlobal("fetch", (url: string, options: any) => {
      if (url.includes("anthropic")) {
        capturedBody = JSON.parse(options.body);
        return mockFetch(url, options);
      }
      return Promise.resolve({
        ok: false, status: 401, text: () => Promise.resolve("No key"),
      });
    });

    await consult({
      question: "test",
      systemPrompt: "You are a pirate.",
    });

    expect(capturedBody.system).toBe("You are a pirate.");

    vi.unstubAllGlobals();
  });

  it("includes latency in result", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant";

    const mockFetch = createMockFetch({
      content: [{ type: "text", text: "OK" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await consult({ question: "test" });

    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.latencyMs).toBeLessThan(10000);

    vi.unstubAllGlobals();
  });
});
