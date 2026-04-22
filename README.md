# frontier-advisor

Infrastructure for a **90:10 local-to-frontier ratio**. Gives local models a governed tool for consulting frontier AI APIs.

```
frontier-advisor/
├── mcp/          # MCP server (standalone, Docker, mcp-vault)
└── pi/           # PI extension (native to pi-coding-agent harness)
```

The local model decides *when* to escalate. The scaffold decides *whether* to allow it. The server routes and returns.

## Choose your integration

### PI Extension (recommended)

For use directly inside [pi-coding-agent](https://github.com/mariozechner/pi-coding-agent).

```
cp pi/frontier-advisor.ts ~/.pi/agent/extensions/
```

- Single TypeScript file, zero dependencies beyond pi itself
- Provider fallback: Anthropic (Sonnet 4.5) → OpenAI (GPT-4.1)
- Credentials from environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)
- Native pi tool registration with `defineTool` pattern
- Uses pi's `AuthStorage` and event system

### MCP Server

For use as a standalone MCP server (Docker, mcp-vault, MCP Toolkit).

See [mcp/README.md](mcp/README.md) for setup.

```bash
cd mcp
pip install -e .
# or
bash install.sh
```

## Tool

| Tool | Purpose |
|---|---|
| `consult_advisor` | Ask a frontier model a question (Sonnet 4.5 primary, GPT-4.1 fallback) |

Parameters: `question` (required), `context` (optional), `system_prompt` (optional override).

## Credentials

| Variable | Required | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | At least one provider | — |
| `OPENAI_API_KEY` | At least one provider | — |
| `ANTHROPIC_BASE_URL` | No | `https://api.anthropic.com` |
| `OPENAI_BASE_URL` | No | `https://api.openai.com` |

## Design

See [mcp/ARCHITECTURE.md](mcp/ARCHITECTURE.md) for full design rationale, the gap analysis, and connection to LAS.

## History

`frontier-advisor-mcp` was originally a single Python MCP server. It's been restructured into `mcp/` (the original Python server, preserved) and `pi/` (the native pi extension). The MCP server still works exactly as before; the PI extension is the new recommended path for pi users.
