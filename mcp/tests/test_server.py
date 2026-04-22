"""Tests for the MCP server tool definitions and handlers."""

import asyncio
import json
import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, patch, MagicMock

from frontier_advisor.server import list_tools, call_tool, _handle_consult, main, run


class TestListTools:
    @pytest.mark.asyncio
    async def test_returns_one_tool(self):
        tools = await list_tools()
        assert len(tools) == 1

    @pytest.mark.asyncio
    async def test_tool_name(self):
        tools = await list_tools()
        assert tools[0].name == "consult_advisor"

    @pytest.mark.asyncio
    async def test_required_fields(self):
        tools = await list_tools()
        schema = tools[0].inputSchema
        assert schema["required"] == ["question"]

    @pytest.mark.asyncio
    async def test_has_question_context_system_prompt(self):
        tools = await list_tools()
        props = tools[0].inputSchema["properties"]
        assert "question" in props
        assert "context" in props
        assert "system_prompt" in props

    @pytest.mark.asyncio
    async def test_no_tier_parameter(self):
        tools = await list_tools()
        props = tools[0].inputSchema["properties"]
        assert "tier" not in props


class TestCallTool:
    @pytest.mark.asyncio
    async def test_unknown_tool_returns_error(self):
        result = await call_tool("nonexistent_tool", {})
        assert len(result) == 1
        data = json.loads(result[0].text)
        assert data["status"] == "error"
        assert "Unknown tool" in data["detail"]


class TestHandleConsult:
    """Tests for _handle_consult function."""

    @pytest.mark.asyncio
    async def test_consult_success(self):
        """Test successful consult returns properly formatted response."""
        mock_result = {
            "response": "This is the advisory response.",
            "provider": "anthropic",
            "model": "claude-opus-4-7",
            "input_tokens": 50,
            "output_tokens": 25,
            "latency_ms": 1234,
        }

        with patch("frontier_advisor.server.adapter") as mock_adapter:
            mock_adapter.consult = AsyncMock(return_value=mock_result)

            result = await _handle_consult({
                "question": "What is the best approach?",
                "context": "Some relevant context.",
            })

            # Verify adapter was called correctly
            mock_adapter.consult.assert_called_once_with(
                question="What is the best approach?",
                context="Some relevant context.",
                system_prompt=None,
            )

            # Verify response format
            assert len(result) == 1
            data = json.loads(result[0].text)
            assert data["status"] == "ok"
            assert data["advisory_response"] == "This is the advisory response."
            assert "metadata" in data

            # Verify all metadata fields
            metadata = data["metadata"]
            assert metadata["provider"] == "anthropic"
            assert metadata["model"] == "claude-opus-4-7"
            assert metadata["input_tokens"] == 50
            assert metadata["output_tokens"] == 25
            assert metadata["latency_ms"] == 1234

    @pytest.mark.asyncio
    async def test_consult_with_custom_system_prompt(self):
        """Test consult with custom system prompt override."""
        mock_result = {
            "response": "Response.",
            "provider": "openai",
            "model": "gpt-4.1",
            "input_tokens": 10,
            "output_tokens": 5,
            "latency_ms": 500,
        }

        with patch("frontier_advisor.server.adapter") as mock_adapter:
            mock_adapter.consult = AsyncMock(return_value=mock_result)

            custom_prompt = "You are a senior architect."
            await _handle_consult({
                "question": "test",
                "system_prompt": custom_prompt,
            })

            # Verify custom system prompt was passed
            call_kwargs = mock_adapter.consult.call_args.kwargs
            assert call_kwargs["system_prompt"] == custom_prompt

    @pytest.mark.asyncio
    async def test_consult_empty_system_prompt_uses_default(self):
        """Test that empty system_prompt is treated as None (uses default)."""
        mock_result = {
            "response": "Response.",
            "provider": "anthropic",
            "model": "claude-opus-4-7",
            "input_tokens": 10,
            "output_tokens": 5,
            "latency_ms": 500,
        }

        with patch("frontier_advisor.server.adapter") as mock_adapter:
            mock_adapter.consult = AsyncMock(return_value=mock_result)

            # Empty string should be converted to None
            await _handle_consult({
                "question": "test",
                "system_prompt": "",  # Empty string
            })

            call_kwargs = mock_adapter.consult.call_args.kwargs
            assert call_kwargs["system_prompt"] is None

    @pytest.mark.asyncio
    async def test_consult_empty_context(self):
        """Test consult with empty context."""
        mock_result = {
            "response": "Response.",
            "provider": "anthropic",
            "model": "claude-opus-4-7",
            "input_tokens": 10,
            "output_tokens": 5,
            "latency_ms": 500,
        }

        with patch("frontier_advisor.server.adapter") as mock_adapter:
            mock_adapter.consult = AsyncMock(return_value=mock_result)

            await _handle_consult({
                "question": "test",
                "context": "",  # Empty context
            })

            call_kwargs = mock_adapter.consult.call_args.kwargs
            assert call_kwargs["context"] == ""

    @pytest.mark.asyncio
    async def test_consult_runtime_error_returns_error_json(self):
        """Test RuntimeError from adapter returns error JSON."""
        with patch("frontier_advisor.server.adapter") as mock_adapter:
            mock_adapter.consult = AsyncMock(
                side_effect=RuntimeError("No provider available")
            )

            result = await _handle_consult({
                "question": "test",
            })

            assert len(result) == 1
            data = json.loads(result[0].text)
            assert data["status"] == "error"
            assert "detail" in data
            assert "No provider available" in data["detail"]

    @pytest.mark.asyncio
    async def test_consult_missing_question_uses_empty_string(self):
        """Test that missing question defaults to empty string."""
        mock_result = {
            "response": "Response.",
            "provider": "anthropic",
            "model": "claude-opus-4-7",
            "input_tokens": 10,
            "output_tokens": 5,
            "latency_ms": 500,
        }

        with patch("frontier_advisor.server.adapter") as mock_adapter:
            mock_adapter.consult = AsyncMock(return_value=mock_result)

            await _handle_consult({})  # No question provided

            call_kwargs = mock_adapter.consult.call_args.kwargs
            assert call_kwargs["question"] == ""


class TestCallToolConsultAdvisor:
    """Integration tests for call_tool with consult_advisor."""

    @pytest.mark.asyncio
    async def test_call_consult_advisor_success(self):
        """Test full call_tool path for consult_advisor."""
        mock_result = {
            "response": "Advisory response.",
            "provider": "anthropic",
            "model": "claude-opus-4-7",
            "input_tokens": 20,
            "output_tokens": 10,
            "latency_ms": 800,
        }

        with patch("frontier_advisor.server.adapter") as mock_adapter:
            mock_adapter.consult = AsyncMock(return_value=mock_result)

            result = await call_tool("consult_advisor", {
                "question": "How should I structure this project?",
                "context": "It's a Python MCP server.",
            })

            assert len(result) == 1
            data = json.loads(result[0].text)
            assert data["status"] == "ok"
            assert "advisory_response" in data
            assert "metadata" in data


class TestServerEntryPoint:
    """Tests for server entry points (main, run)."""

    def test_main_calls_asyncio_run(self):
        """Test that main() calls asyncio.run(run())."""
        with patch("frontier_advisor.server.asyncio.run") as mock_run:
            # Mock the run coroutine to return a completed task
            async def mock_asyncio_run(coro):
                return None

            mock_run.side_effect = mock_asyncio_run

            main()

            # Verify asyncio.run was called
            mock_run.assert_called_once()

    @pytest.mark.asyncio
    async def test_run_uses_stdio_server(self):
        """Test that run() uses stdio_server context manager."""
        from frontier_advisor.server import stdio_server, server as mcp_server

        # Mock stdio_server to return mock streams
        mock_read = AsyncMock()
        mock_write = AsyncMock()

        # Must be synchronous - returns an async context manager
        def mock_stdio_server():
            class MockContext:
                async def __aenter__(self):
                    return (mock_read, mock_write)
                async def __aexit__(self, *args):
                    pass
            return MockContext()

        # Mock server.run to avoid actual MCP communication
        with patch("frontier_advisor.server.stdio_server", mock_stdio_server):
            with patch.object(mcp_server, "run", new_callable=AsyncMock) as mock_server_run:
                # This will test line 109 (context manager entry)
                await run()

                # Verify stdio_server was used (context manager entered)
                mock_server_run.assert_called()
