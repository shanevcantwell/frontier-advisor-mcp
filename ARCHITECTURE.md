# frontier-advisor-mcp

## What It Is

An MCP server that gives a local model a **tool for consulting frontier AI**. The local model decides *when* to escalate. The scaffold decides *whether* to allow it. The server routes the request, logs the interaction, and returns the result.

This is the infrastructure for a **90:10 local-to-frontier ratio**.

## What Exists Today (March 2026)

| Approach | What It Does | Gap |
|---|---|---|
| **LiteLLM Proxy** | Routes ALL inference through gateway with budget tracking | Not local-first. Proxy for everything, not selective escalation. |
| **codev consult script** | Thin CLI wrapper, Claude Code calls Gemini | No audit, no governance. Acknowledged as unsafe. |
| **MCP + Ollama** | Local models using MCP tools for file/search | Tools extend the model -- none consult a smarter model. |
| **PAL Model Bridge** | MCP server connecting models to each other | No sovereign framing. Context-heavy. |

**The gap**: No MCP tool for advisory consultation with tier routing and audit.

## Architecture

```
Local Model (qwen3-30b on local HW)
  -> decides it needs help
  -> MCP tool call: consult_frontier(question, tier, context)
  -> frontier-advisor MCP server
    -> tier routing (quick/standard/deep)
    -> provider fallback (Anthropic -> OpenAI)
    -> audit log (JSONL record)
  -> Frontier API (system prompt: treat local model as peer)
  -> response + metadata returned to local model
```

Access control (how often, how much) is the scaffold's responsibility — not the MCP server's. The server routes and logs.

## Tools Exposed

| Tool | Purpose |
|---|---|
| consult_frontier | Ask frontier model a question with tier selection |
| advisory_history | Review recent consultations (avoid re-asking) |
| describe_advisory_tiers | List tiers and model preferences |

## Advisory Tiers

Local model picks the tier, not the provider:

| Tier | Use Case | Max Tokens | Models |
|---|---|---|---|
| quick | Factual verification, syntax | 512 | Haiku 4.5, GPT-4.1-mini |
| standard | Complex reasoning | 2048 | Sonnet 4.5, GPT-4.1 |
| deep | Architecture, novel synthesis | 4096 | Opus 4.6, o3 |

## Credentials

Credentials come from environment variables:

| Variable | Required | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | At least one provider | — |
| `OPENAI_API_KEY` | At least one provider | — |
| `ANTHROPIC_BASE_URL` | No | `https://api.anthropic.com` |
| `OPENAI_BASE_URL` | No | `https://api.openai.com` |

Designed for [mcp-vault](https://github.com/shanevcantwell/mcp-vault) — env vars in `mcp.json` use `vault:` references that mcp-vault resolves from the OS credential store at process spawn. No plaintext secrets in config files.

## Connection to LAS

Natural fit as an MCP tool for GraphOrchestrator. Specialists call consult_frontier directly via MCP (MCP = System Calls in LAS — bypasses Router). The scaffold controls access by deciding whether to expose the tool to a given specialist.

Advisory audit log entries are strings for now — structural compatibility with Archiver routing_history is a future integration point.

## Dependencies

```
pip install mcp httpx
```

No frameworks, no orchestration libraries, no database. Single package, stdio.
