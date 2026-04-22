# frontier-advisor

Infrastructure for a **90:10 local-to-frontier ratio**. Gives local models a governed tool for consulting frontier AI APIs.

```
frontier-advisor/
├── mcp/          # MCP server (Python, Docker, mcp-vault)
└── pi/           # PI extension (TypeScript, native to pi-coding-agent)
```

The local model decides *when* to escalate. The scaffold decides *whether* to allow it. The server routes and returns.

---

## PI Extension (recommended)

Use the `consult_advisor` tool directly inside [pi-coding-agent](https://github.com/mariozechner/pi-coding-agent):

```bash
cp pi/frontier-advisor.ts ~/.pi/agent/extensions/
```

Then run `pi` — the tool appears automatically. No configuration needed beyond setting your API keys.

**How it works:**

```
LLM calls consult_advisor(question, context?)
  → pi extension runs adapter.ts
  → tries Anthropic Sonnet 4.5 first
  → falls back to OpenAI GPT-4.1
  → returns response + metadata (provider, model, tokens, latency)
```

**Architecture:**

| File | Purpose |
|---|---|
| `adapter.ts` | Standalone adapter — provider logic, HTTP clients, fallback. No pi dependencies. Testable on its own. |
| `tool.ts` | Harness-agnostic tool definition — schema, name, description, prompt metadata. |
| `frontier-advisor.ts` | Extension entry point — imports adapter + tool, registers with pi via `registerTool()`. |

**Tests:** `npx vitest run` in the `pi/` directory. 43 tests covering adapter logic, credential resolution, HTTP clients, and tool schema.

**Credentials:** Environment variables — `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY`. Override URLs with `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` for proxies.

---

## MCP Server

Use the standalone MCP server with Docker, mcp-vault, or MCP Toolkit:

```bash
cd mcp
pip install -e .
# or
bash install.sh
```

**How it works:**

```
LLM calls consult_advisor(question, context?)
  → MCP stdio transport
  → tries Anthropic Sonnet 4.5 first
  → falls back to OpenAI GPT-4.1
  → JSON-RPC result returned to LLM
```

See [mcp/README.md](mcp/README.md) for Docker, mcp-vault, and Toolkit installation options.

---

## Tool

| Tool | Purpose |
|---|---|
| `consult_advisor` | Ask a frontier model a question (Sonnet 4.5 primary, GPT-4.1 fallback) |

Parameters: `question` (required), `context` (optional), `system_prompt` (optional override).

---

## Credentials

| Variable | Required | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | At least one provider | — |
| `OPENAI_API_KEY` | At least one provider | — |
| `ANTHROPIC_BASE_URL` | No | `https://api.anthropic.com` |
| `OPENAI_BASE_URL` | No | `https://api.openai.com` |

---

## Design

See [mcp/ARCHITECTURE.md](mcp/ARCHITECTURE.md) for the gap analysis, connection to LAS, and rationale.

The core design is identical across both integrations: same model preference list, same fallback logic, same system prompt. The adapter logic was extracted into a shared standalone module so there's no divergence — what the PI extension calls is exactly what the MCP server calls.

---

## History

Originally `frontier-advisor-mcp`, a single Python MCP server. Restructured into `mcp/` (preserved) and `pi/` (native extension). The name was removed from the repo to reflect that the project is now a dual-integration toolkit, not just an MCP server.
