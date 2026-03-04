# frontier-advisor-mcp

MCP server that gives local models a tool for consulting frontier AI APIs. The local model decides when to escalate. The scaffold controls access. The server routes, logs, and returns.

See [ARCHITECTURE.md](ARCHITECTURE.md) for design rationale.

## Tools

| Tool | Purpose |
|---|---|
| `consult_frontier` | Ask a frontier model a question (quick/standard/deep tiers) |
| `advisory_history` | Review recent consultations to avoid re-asking |
| `describe_advisory_tiers` | List available tiers and model preferences |

## Quick Start

```bash
git clone https://github.com/Shane/frontier-advisor-mcp.git
cd frontier-advisor-mcp
bash install.sh        # Linux / macOS / Git Bash
install.bat            # Windows (cmd or PowerShell)
```

The installer builds the Docker image and walks you through setup:

```
  ┌─────────────────────────────────────────┐
  │       frontier-advisor-mcp  setup        │
  └─────────────────────────────────────────┘

  1)  Docker + mcp-vault     (OS keychain, recommended)
  2)  Docker + env vars      (quick start)
  3)  Docker MCP Toolkit     (gateway + mcp.json)

  Pick an option [1/2/3]:
```

**Option 1** uses [mcp-vault](https://github.com/Shane/mcp-vault) to keep API keys in your OS credential store. Your `mcp.json` becomes safe to share, screenshot, or paste in help channels.

**Option 2** gets you running fast with env vars in `mcp.json`. Fine for trying it out, but consider option 1 for regular use.

**Option 3** registers the server in Docker Desktop's MCP gateway for tool routing via `docker mcp client connect`. API keys still go in `mcp.json` — custom catalog servers don't yet appear in the Desktop UI secrets panel.

See [mcp.json.example](mcp.json.example) for the recommended client configuration.

### Manual install (no Docker)

```bash
pip install -e .
```

```json
{
  "mcpServers": {
    "frontier-advisor": {
      "command": "frontier-advisor",
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | At least one provider | — |
| `OPENAI_API_KEY` | At least one provider | — |
| `ANTHROPIC_BASE_URL` | No | `https://api.anthropic.com` |
| `OPENAI_BASE_URL` | No | `https://api.openai.com` |

## Advisory Tiers

| Tier | Use Case | Max Tokens | Models |
|---|---|---|---|
| quick | Factual verification, syntax | 512 | Haiku 4.5, GPT-4.1-mini |
| standard | Complex reasoning | 2048 | Sonnet 4.5, GPT-4.1 |
| deep | Architecture, novel synthesis | 4096 | Opus 4.6, o3 |

The local model picks the tier. The server picks the provider (first available in the tier's preference list, with fallback).

## Development

```bash
pip install -e ".[dev]"
pytest
```
