"""frontier-advisor-mcp: MCP server giving local models a tool
for consulting frontier AI APIs.

The local model decides WHEN to escalate. The scaffold decides
WHETHER to allow it. This server routes, logs, and returns.
"""

import asyncio
import json
import logging
import sys

from mcp.server import Server
from mcp.server.stdio import stdio_server
import mcp.types as types

from frontier_advisor.adapter import FrontierAdapter
from frontier_advisor.audit import AdvisoryAuditLog
from frontier_advisor.tiers import ADVISORY_TIERS

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger(__name__)

server = Server("frontier-advisor")
adapter = FrontierAdapter()
audit = AdvisoryAuditLog()


@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="consult_frontier",
            description=(
                "Consult a frontier AI model for advisory input. "
                "Use when local capabilities are insufficient for the task — "
                "complex reasoning, architecture decisions, novel synthesis, "
                "or factual verification beyond training data. "
                "Frame the question precisely. "
                "Check advisory_history first to avoid re-asking."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "The question to ask the frontier model. Be precise.",
                    },
                    "tier": {
                        "type": "string",
                        "enum": ["quick", "standard", "deep"],
                        "default": "standard",
                        "description": (
                            "Advisory tier. quick: factual checks, syntax. "
                            "standard: complex reasoning. "
                            "deep: architecture, novel synthesis."
                        ),
                    },
                    "context": {
                        "type": "string",
                        "default": "",
                        "description": (
                            "Supporting context the frontier model needs. "
                            "ONLY what is necessary."
                        ),
                    },
                    "system_prompt": {
                        "type": "string",
                        "default": "",
                        "description": "Override the default advisory system prompt.",
                    },
                },
                "required": ["question"],
            },
        ),
        types.Tool(
            name="advisory_history",
            description=(
                "Review recent frontier consultations. Check before consulting "
                "to avoid re-asking the same or similar questions."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "n": {
                        "type": "integer",
                        "default": 5,
                        "description": "Number of recent entries to return (max 50).",
                    },
                },
            },
        ),
        types.Tool(
            name="describe_advisory_tiers",
            description="List available advisory tiers and model preferences.",
            inputSchema={
                "type": "object",
                "properties": {},
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    if name == "consult_frontier":
        return await _handle_consult(arguments)
    elif name == "advisory_history":
        return _handle_history(arguments)
    elif name == "describe_advisory_tiers":
        return _handle_describe_tiers()
    else:
        return [types.TextContent(
            type="text",
            text=json.dumps({"status": "error", "detail": f"Unknown tool: {name}"}),
        )]


async def _handle_consult(arguments: dict) -> list[types.TextContent]:
    question = arguments.get("question", "")
    tier = arguments.get("tier", "standard")
    context = arguments.get("context", "")
    system_prompt = arguments.get("system_prompt", "") or None

    if tier not in ADVISORY_TIERS:
        tier = "standard"

    try:
        result = await adapter.consult(
            question=question, context=context, tier=tier,
            system_prompt=system_prompt,
        )
    except RuntimeError as e:
        audit.log({
            "event": "provider_error",
            "tier": tier,
            "error": str(e),
            "question_preview": question[:200],
        })
        return [types.TextContent(
            type="text",
            text=json.dumps({"status": "error", "detail": str(e)}, indent=2),
        )]

    audit.log({
        "event": "consultation",
        "tier": tier,
        "provider": result["provider"],
        "model": result["model"],
        "input_tokens": result["input_tokens"],
        "output_tokens": result["output_tokens"],
        "latency_ms": result["latency_ms"],
        "question_preview": question[:200],
    })

    return [types.TextContent(type="text", text=json.dumps({
        "status": "ok",
        "advisory_response": result["response"],
        "metadata": {
            "provider": result["provider"],
            "model": result["model"],
            "tier": tier,
            "input_tokens": result["input_tokens"],
            "output_tokens": result["output_tokens"],
            "latency_ms": result["latency_ms"],
        },
    }, indent=2))]


def _handle_history(arguments: dict) -> list[types.TextContent]:
    n = min(max(1, arguments.get("n", 5)), 50)
    entries = audit.recent(n)
    return [types.TextContent(type="text", text=json.dumps({
        "recent": entries,
        "count": len(entries),
    }, indent=2))]


def _handle_describe_tiers() -> list[types.TextContent]:
    return [types.TextContent(type="text", text=json.dumps(
        ADVISORY_TIERS, indent=2,
    ))]


async def run():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream, write_stream,
            server.create_initialization_options(),
        )


def main():
    asyncio.run(run())


if __name__ == "__main__":
    main()
