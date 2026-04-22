"""Frontier model adapter with provider fallback.

Credentials from environment variables:
  ANTHROPIC_API_KEY  — Anthropic API key
  OPENAI_API_KEY     — OpenAI API key

Base URLs default to the public APIs. Override with:
  ANTHROPIC_BASE_URL — default: https://api.anthropic.com
  OPENAI_BASE_URL    — default: https://api.openai.com

With mcp-vault, these become vault: references in mcp.json env block,
resolved transparently at process spawn.
"""

import logging
import os
import time

import httpx

logger = logging.getLogger(__name__)

DEFAULT_SYSTEM_PROMPT = (
    "You are being consulted as a frontier advisory model by a local AI system "
    "that handles most tasks independently. You are called only when the local "
    "model has determined it needs capabilities beyond its own. "
    "Be direct, substantive, and efficient with tokens. "
    "Do not repeat the question back. Do not pad with caveats. "
    "The local model is technically competent -- treat it as a peer."
)

MAX_TOKENS = 4096

MODEL_PREFERENCE = [
    ("anthropic", "claude-opus-4-7"),
    ("openai", "gpt-4.1"),
]

PROVIDER_CONFIG = {
    "anthropic": {
        "env_key": "ANTHROPIC_API_KEY",
        "env_base_url": "ANTHROPIC_BASE_URL",
        "default_base_url": "https://api.anthropic.com",
    },
    "openai": {
        "env_key": "OPENAI_API_KEY",
        "env_base_url": "OPENAI_BASE_URL",
        "default_base_url": "https://api.openai.com",
    },
}


class FrontierAdapter:
    def __init__(self):
        self._client = httpx.AsyncClient(timeout=120.0)

    def _get_provider_config(self, provider: str) -> dict | None:
        """Read provider credentials from environment."""
        cfg = PROVIDER_CONFIG.get(provider)
        if not cfg:
            return None
        api_key = os.environ.get(cfg["env_key"])
        if not api_key:
            return None
        return {
            "api_key": api_key,
            "base_url": os.environ.get(cfg["env_base_url"], cfg["default_base_url"]),
        }

    async def consult(
        self,
        question: str,
        context: str = "",
        system_prompt: str | None = None,
    ) -> dict:
        """Send question to frontier model with provider fallback.

        Tries each model in preference order until one succeeds.
        Returns dict with response, provider, model, token counts, latency.
        Raises RuntimeError if all providers fail.
        """
        sys_prompt = system_prompt or DEFAULT_SYSTEM_PROMPT
        last_error = None

        for provider, model_id in MODEL_PREFERENCE:
            creds = self._get_provider_config(provider)
            if not creds:
                continue
            try:
                start = time.monotonic()
                result = await self._call(
                    provider, model_id, question, context,
                    MAX_TOKENS, sys_prompt, creds,
                )
                latency = int((time.monotonic() - start) * 1000)
                return {
                    "response": result["text"],
                    "provider": provider,
                    "model": model_id,
                    "input_tokens": result["input_tokens"],
                    "output_tokens": result["output_tokens"],
                    "latency_ms": latency,
                }
            except Exception as e:
                logger.warning("Provider %s/%s failed: %s", provider, model_id, e)
                last_error = e

        raise RuntimeError(
            f"No provider available. Last error: {last_error}"
        )

    async def _call(self, provider, model, q, ctx, max_tok, sys_prompt, creds):
        if provider == "anthropic":
            return await self._anthropic(model, q, ctx, max_tok, sys_prompt, creds)
        return await self._openai(model, q, ctx, max_tok, sys_prompt, creds)

    async def _anthropic(self, model, q, ctx, max_tok, sys_prompt, creds):
        headers = {
            "x-api-key": creds["api_key"],
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        user_content = q
        if ctx:
            user_content = (
                f"<advisory_context>\n{ctx}\n</advisory_context>\n\n"
                f"<advisory_question>\n{q}\n</advisory_question>"
            )
        body = {
            "model": model,
            "max_tokens": max_tok,
            "system": sys_prompt,
            "messages": [{"role": "user", "content": user_content}],
        }
        resp = await self._client.post(
            f"{creds['base_url']}/v1/messages", headers=headers, json=body,
        )
        resp.raise_for_status()
        data = resp.json()
        text = "".join(b["text"] for b in data["content"] if b["type"] == "text")
        return {
            "text": text,
            "input_tokens": data["usage"]["input_tokens"],
            "output_tokens": data["usage"]["output_tokens"],
        }

    async def _openai(self, model, q, ctx, max_tok, sys_prompt, creds):
        headers = {
            "Authorization": f"Bearer {creds['api_key']}",
            "Content-Type": "application/json",
        }
        msgs = [{"role": "system", "content": sys_prompt}]
        user_content = f"Context:\n{ctx}\n\nQuestion:\n{q}" if ctx else q
        msgs.append({"role": "user", "content": user_content})
        body = {
            "model": model,
            "max_tokens": max_tok,
            "messages": msgs,
        }
        resp = await self._client.post(
            f"{creds['base_url']}/v1/chat/completions", headers=headers, json=body,
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "text": data["choices"][0]["message"]["content"],
            "input_tokens": data["usage"]["prompt_tokens"],
            "output_tokens": data["usage"]["completion_tokens"],
        }
