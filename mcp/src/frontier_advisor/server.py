"""frontier-advisor-mcp: MCP server giving local models a tool
for consulting frontier AI APIs.

The local model decides WHEN to escalate. The scaffold decides
WHETHER to allow it. This server routes and returns.
"""

import asyncio
import json
import logging
import sys

from mcp.server import Server
from mcp.server.stdio import stdio_server
import mcp.types as types

from frontier_advisor.adapter import FrontierAdapter

logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger(__name__)

server = Server("frontier-advisor")
adapter = FrontierAdapter()


@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="consult_advisor",
            description=(
                "Consult a frontier AI model for advisory input. "
                "Use when local capabilities are insufficient — "
                "complex reasoning, architecture decisions, novel synthesis, "
                "or factual verification beyond training data. "
                "Frame the question precisely."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "The question to ask the frontier model. Be precise.",
                    },
                    "context": {
                        "type": "string",
                        "default": "",
                        "description": (
                            "Supporting context the frontier model needs. "
                            "Only what is necessary."
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
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    if name == "consult_advisor":
        return await _handle_consult(arguments)
    return [types.TextContent(
        type="text",
        text=json.dumps({"status": "error", "detail": f"Unknown tool: {name}"}),
    )]


async def _handle_consult(arguments: dict) -> list[types.TextContent]:
    question = arguments.get("question", "")
    context = arguments.get("context", "")
    system_prompt = arguments.get("system_prompt", "") or None

    try:
        result = await adapter.consult(
            question=question, context=context,
            system_prompt=system_prompt,
        )
    except RuntimeError as e:
        return [types.TextContent(
            type="text",
            text=json.dumps({"status": "error", "detail": str(e)}, indent=2),
        )]

    return [types.TextContent(type="text", text=json.dumps({
        "status": "ok",
        "advisory_response": result["response"],
        "metadata": {
            "provider": result["provider"],
            "model": result["model"],
            "input_tokens": result["input_tokens"],
            "output_tokens": result["output_tokens"],
            "latency_ms": result["latency_ms"],
        },
    }, indent=2))]


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
