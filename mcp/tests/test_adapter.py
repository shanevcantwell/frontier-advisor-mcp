"""Tests for FrontierAdapter."""

import json
import httpx
import pytest
from frontier_advisor.adapter import (
    FrontierAdapter,
    MODEL_PREFERENCE,
    MAX_TOKENS,
    DEFAULT_SYSTEM_PROMPT,
    PROVIDER_CONFIG,
)


class TestAdapterConfig:
    def test_model_preference_not_empty(self):
        assert len(MODEL_PREFERENCE) > 0

    def test_model_preference_has_anthropic(self):
        providers = [p for p, _ in MODEL_PREFERENCE]
        assert "anthropic" in providers

    def test_model_preference_has_openai(self):
        providers = [p for p, _ in MODEL_PREFERENCE]
        assert "openai" in providers

    def test_max_tokens_positive(self):
        assert MAX_TOKENS > 0

    def test_system_prompt_not_empty(self):
        assert len(DEFAULT_SYSTEM_PROMPT) > 0

    def test_provider_config_has_env_keys(self):
        for provider, cfg in PROVIDER_CONFIG.items():
            assert "env_key" in cfg
            assert "default_base_url" in cfg


class TestAdapterInit:
    def test_creates_http_client(self):
        adapter = FrontierAdapter()
        assert adapter._client is not None

    @pytest.mark.asyncio
    async def test_no_keys_raises_runtime_error(self, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        adapter = FrontierAdapter()
        with pytest.raises(RuntimeError, match="No provider available"):
            await adapter.consult(question="test")

    def test_get_provider_config_missing_key(self, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        adapter = FrontierAdapter()
        assert adapter._get_provider_config("anthropic") is None

    def test_get_provider_config_present_key(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        monkeypatch.delenv("ANTHROPIC_BASE_URL", raising=False)
        adapter = FrontierAdapter()
        cfg = adapter._get_provider_config("anthropic")
        assert cfg is not None
        assert cfg["api_key"] == "sk-test"
        assert "api.anthropic.com" in cfg["base_url"]

    def test_get_provider_config_unknown_provider(self, monkeypatch):
        """Test that unknown provider returns None."""
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        adapter = FrontierAdapter()
        assert adapter._get_provider_config("unknown_provider") is None
        assert adapter._get_provider_config("google") is None
        assert adapter._get_provider_config("") is None
        assert adapter._get_provider_config(None) is None

    def test_get_provider_config_custom_base_url(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        monkeypatch.setenv("OPENAI_BASE_URL", "http://localhost:8080")
        adapter = FrontierAdapter()
        cfg = adapter._get_provider_config("openai")
        assert cfg["base_url"] == "http://localhost:8080"


class TestAdapterAnthropic:
    """Tests for Anthropic provider integration."""

    @pytest.mark.asyncio
    async def test_anthropic_success(self, monkeypatch, respx_mock):
        """Test successful Anthropic API call."""
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-anthropic-test")
        monkeypatch.delenv("ANTHROPIC_BASE_URL", raising=False)
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)

        adapter = FrontierAdapter()

        # Mock Anthropic API response
        mock_response = {
            "content": [
                {"type": "text", "text": "This is the advisory response."},
            ],
            "usage": {"input_tokens": 10, "output_tokens": 8},
        }
        respx_mock.post("https://api.anthropic.com/v1/messages").respond(
            json=mock_response, status_code=200
        )

        result = await adapter.consult(question="What is 2+2?")

        assert result["response"] == "This is the advisory response."
        assert result["provider"] == "anthropic"
        assert result["model"] == "claude-sonnet-4-5-20250929"
        assert result["input_tokens"] == 10
        assert result["output_tokens"] == 8
        assert "latency_ms" in result
        assert result["latency_ms"] >= 0

    @pytest.mark.asyncio
    async def test_anthropic_with_context(self, monkeypatch, respx_mock):
        """Test Anthropic API call with advisory context."""
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-anthropic-test")
        monkeypatch.delenv("ANTHROPIC_BASE_URL", raising=False)

        adapter = FrontierAdapter()
        context = "The user is working on a Python project."
        question = "Should I use pytest or unittest?"

        # Use respx's side_effect to capture request
        captured_body = None

        def respond_with_capture(request):
            nonlocal captured_body
            captured_body = json.loads(request.content)
            return httpx.Response(
                200,
                json={
                    "content": [{"type": "text", "text": "Use pytest."}],
                    "usage": {"input_tokens": 15, "output_tokens": 3},
                }
            )

        route = respx_mock.post("https://api.anthropic.com/v1/messages")
        route.side_effect = respond_with_capture

        await adapter.consult(question=question, context=context)

        # Verify context was injected with XML tags
        user_content = captured_body["messages"][0]["content"]
        assert "<advisory_context>" in user_content
        assert "<advisory_question>" in user_content
        assert context in user_content
        assert question in user_content

    @pytest.mark.asyncio
    async def test_anthropic_multiple_content_blocks(self, monkeypatch, respx_mock):
        """Test Anthropic response with multiple content blocks (text and non-text)."""
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-anthropic-test")
        monkeypatch.delenv("ANTHROPIC_BASE_URL", raising=False)

        adapter = FrontierAdapter()

        mock_response = {
            "content": [
                {"type": "text", "text": "First part of "},
                {"type": "tool_use", "id": "tool1", "name": "calculator"},
                {"type": "text", "text": "second part."},
            ],
            "usage": {"input_tokens": 5, "output_tokens": 10},
        }
        respx_mock.post("https://api.anthropic.com/v1/messages").respond(
            json=mock_response, status_code=200
        )

        result = await adapter.consult(question="test")

        # Should only concatenate text blocks
        assert result["response"] == "First part of second part."

    @pytest.mark.asyncio
    async def test_anthropic_http_error(self, monkeypatch, respx_mock):
        """Test Anthropic API HTTP error handling."""
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-anthropic-test")
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)

        adapter = FrontierAdapter()

        respx_mock.post("https://api.anthropic.com/v1/messages").respond(
            status_code=401, json={"error": "Invalid API key"}
        )

        with pytest.raises(RuntimeError, match="No provider available"):
            await adapter.consult(question="test")


class TestAdapterOpenAI:
    """Tests for OpenAI provider integration."""

    @pytest.mark.asyncio
    async def test_openai_success(self, monkeypatch, respx_mock):
        """Test successful OpenAI API call."""
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-test")

        adapter = FrontierAdapter()

        mock_response = {
            "choices": [
                {
                    "message": {"content": "OpenAI advisory response."},
                }
            ],
            "usage": {"prompt_tokens": 12, "completion_tokens": 6},
        }
        respx_mock.post("https://api.openai.com/v1/chat/completions").respond(
            json=mock_response, status_code=200
        )

        result = await adapter.consult(question="What is the capital of France?")

        assert result["response"] == "OpenAI advisory response."
        assert result["provider"] == "openai"
        assert result["model"] == "gpt-4.1"
        assert result["input_tokens"] == 12
        assert result["output_tokens"] == 6
        assert "latency_ms" in result

    @pytest.mark.asyncio
    async def test_openai_with_context(self, monkeypatch, respx_mock):
        """Test OpenAI API call with context."""
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.delenv("ANTHROPIC_BASE_URL", raising=False)
        monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-test")

        adapter = FrontierAdapter()
        context = "Project uses React and TypeScript."
        question = "Should I use Redux or Zustand?"

        captured_body = None

        def respond_with_capture(request):
            nonlocal captured_body
            captured_body = json.loads(request.content)
            return httpx.Response(
                200,
                json={
                    "choices": [{"message": {"content": "Use Zustand."}}],
                    "usage": {"prompt_tokens": 20, "completion_tokens": 3},
                }
            )

        route = respx_mock.post("https://api.openai.com/v1/chat/completions")
        route.side_effect = respond_with_capture

        await adapter.consult(question=question, context=context)

        # Verify system and user messages
        messages = captured_body["messages"]
        assert len(messages) == 2
        assert messages[0]["role"] == "system"
        assert messages[1]["role"] == "user"
        assert context in messages[1]["content"]
        assert question in messages[1]["content"]

    @pytest.mark.asyncio
    async def test_openai_custom_base_url(self, monkeypatch, respx_mock):
        """Test OpenAI with custom base URL (e.g., local proxy)."""
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        monkeypatch.setenv("OPENAI_BASE_URL", "http://localhost:8080")

        adapter = FrontierAdapter()

        mock_response = {
            "choices": [{"message": {"content": "Response from local proxy."}}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 5},
        }
        respx_mock.post("http://localhost:8080/v1/chat/completions").respond(
            json=mock_response, status_code=200
        )

        result = await adapter.consult(question="test")

        assert result["response"] == "Response from local proxy."
        assert result["provider"] == "openai"


class TestAdapterFallback:
    """Tests for provider fallback behavior."""

    @pytest.mark.asyncio
    async def test_fallback_anthropic_to_openai(self, monkeypatch, respx_mock):
        """Test fallback from Anthropic to OpenAI when Anthropic fails."""
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-anthropic-test")
        monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-test")

        adapter = FrontierAdapter()

        # Anthropic fails
        respx_mock.post("https://api.anthropic.com/v1/messages").respond(
            status_code=500
        )

        # OpenAI succeeds
        mock_response = {
            "choices": [{"message": {"content": "Fallback response."}}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 3},
        }
        respx_mock.post("https://api.openai.com/v1/chat/completions").respond(
            json=mock_response, status_code=200
        )

        result = await adapter.consult(question="test")

        # Should have fallen back to OpenAI
        assert result["provider"] == "openai"
        assert result["response"] == "Fallback response."

    @pytest.mark.asyncio
    async def test_fallback_prefers_anthropic(self, monkeypatch, respx_mock):
        """Test that Anthropic is tried first when both are available."""
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-anthropic-test")
        monkeypatch.delenv("ANTHROPIC_BASE_URL", raising=False)
        monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-test")

        adapter = FrontierAdapter()

        # Both succeed, but Anthropic should be used
        respx_mock.post("https://api.anthropic.com/v1/messages").respond(
            json={
                "content": [{"type": "text", "text": "Anthropic response."}],
                "usage": {"input_tokens": 5, "output_tokens": 3},
            },
            status_code=200,
        )
        respx_mock.post("https://api.openai.com/v1/chat/completions").respond(
            json={
                "choices": [{"message": {"content": "OpenAI response."}}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 3},
            },
            status_code=200,
        )

        result = await adapter.consult(question="test")

        # Anthropic should be used (first in preference)
        assert result["provider"] == "anthropic"
        assert result["response"] == "Anthropic response."

    @pytest.mark.asyncio
    async def test_custom_system_prompt(self, monkeypatch, respx_mock):
        """Test custom system prompt is passed to provider."""
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-anthropic-test")
        monkeypatch.delenv("ANTHROPIC_BASE_URL", raising=False)

        adapter = FrontierAdapter()
        custom_prompt = "You are a helpful coding assistant."

        captured_body = None

        def respond_with_capture(request):
            nonlocal captured_body
            captured_body = json.loads(request.content)
            return httpx.Response(
                200,
                json={
                    "content": [{"type": "text", "text": "Response."}],
                    "usage": {"input_tokens": 5, "output_tokens": 1},
                }
            )

        route = respx_mock.post("https://api.anthropic.com/v1/messages")
        route.side_effect = respond_with_capture

        await adapter.consult(
            question="test",
            system_prompt=custom_prompt,
        )

        assert captured_body["system"] == custom_prompt
