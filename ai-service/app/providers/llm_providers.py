"""Concrete AIProvider implementations: Mock (deterministic), Gemini, Ollama.

Selection is driven by AI_PROVIDER. If a provider is configured but its key or
daemon is missing, we degrade to the deterministic provider rather than failing
the request - the scheduling platform must never stop because an LLM is down.
"""
from __future__ import annotations

import json
import logging

import httpx

from ..config import get_settings
from .base import AIProvider, LlmUnavailable

log = logging.getLogger("ai.provider")


class MockAIProvider(AIProvider):
    """DEMO MODE provider.

    It is NOT a language model and does not pretend to be one: `is_llm = False`
    routes every call straight to the deterministic extractors, and the API
    reports `provider: "deterministic"` so no output is ever mislabelled as
    model-generated.
    """

    name = "deterministic"
    is_llm = False

    def complete_json(self, prompt: str, schema_hint: str) -> str:  # pragma: no cover
        raise LlmUnavailable("mock provider does not call a model")


class GeminiProvider(AIProvider):
    """Google Gemini via the free-tier REST API (no SDK dependency)."""

    name = "gemini"
    is_llm = True

    def __init__(self) -> None:
        s = get_settings()
        self.api_key = s.gemini_api_key
        self.model = s.gemini_model
        self.timeout = s.llm_timeout_seconds

    def available(self) -> bool:
        return bool(self.api_key)

    def complete_json(self, prompt: str, schema_hint: str) -> str:
        if not self.api_key:
            raise LlmUnavailable("GEMINI_API_KEY is not set")

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        body = {
            "contents": [{"parts": [{"text": f"{prompt}\n\nJSON schema properties:\n{schema_hint}"}]}],
            "generationConfig": {
                # Greedy, not merely cold. These calls produce scores a recruiter
                # ranks people by; the same inputs must give the same answer twice.
                "temperature": 0.0,
                "topP": 1.0,
                "responseMimeType": "application/json",
                "maxOutputTokens": 2048,
            },
        }
        try:
            with httpx.Client(timeout=self.timeout) as client:
                resp = client.post(url, params={"key": self.api_key}, json=body)
        except httpx.HTTPError as exc:
            raise LlmUnavailable(f"Gemini unreachable: {exc}") from exc

        if resp.status_code == 429:
            raise LlmUnavailable("Gemini free-tier rate limit reached")
        if resp.status_code >= 400:
            raise LlmUnavailable(f"Gemini error {resp.status_code}: {resp.text[:200]}")

        data = resp.json()
        try:
            return data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError) as exc:
            raise ValueError(f"unexpected Gemini payload: {json.dumps(data)[:200]}") from exc


class OllamaProvider(AIProvider):
    """Local LLM through Ollama - fully offline, no API key, no quota."""

    name = "ollama"
    is_llm = True

    def __init__(self) -> None:
        s = get_settings()
        self.base_url = s.ollama_base_url.rstrip("/")
        self.model = s.ollama_model
        self.timeout = s.llm_timeout_seconds

    def available(self) -> bool:
        try:
            with httpx.Client(timeout=2.0) as client:
                return client.get(f"{self.base_url}/api/tags").status_code == 200
        except httpx.HTTPError:
            return False

    def complete_json(self, prompt: str, schema_hint: str) -> str:
        body = {
            "model": self.model,
            "prompt": f"{prompt}\n\nJSON schema properties:\n{schema_hint}",
            "stream": False,
            "format": "json",
            # Greedy decoding. At temperature 0.1 Ollama still samples, and the
            # judgement genuinely moved between identical calls - "PostgreSQL
            # covers Relational Databases" scored 100, then 80, then 0 across
            # three runs of the same request. A panel ranking that changes when
            # you reload the page is a bug, so decode deterministically.
            "options": {"temperature": 0.0, "top_p": 1.0, "top_k": 1, "seed": 7},
        }
        try:
            with httpx.Client(timeout=self.timeout) as client:
                resp = client.post(f"{self.base_url}/api/generate", json=body)
        except httpx.HTTPError as exc:
            raise LlmUnavailable(f"Ollama unreachable at {self.base_url}: {exc}") from exc

        if resp.status_code >= 400:
            raise LlmUnavailable(f"Ollama error {resp.status_code}: {resp.text[:200]}")
        return resp.json().get("response", "")


_provider: AIProvider | None = None


def get_provider() -> AIProvider:
    """Resolve the configured provider once, degrading gracefully."""
    global _provider  # noqa: PLW0603 - single process-wide provider
    if _provider is not None:
        return _provider

    s = get_settings()
    choice = s.ai_provider

    if choice == "gemini":
        provider: AIProvider = GeminiProvider()
        if not provider.available():
            log.warning("AI_PROVIDER=gemini but GEMINI_API_KEY is empty - using the deterministic provider")
            provider = MockAIProvider()
    elif choice == "ollama":
        provider = OllamaProvider()
        if not provider.available():
            log.warning("AI_PROVIDER=ollama but no daemon answered - using the deterministic provider")
            provider = MockAIProvider()
    else:
        provider = MockAIProvider()

    _provider = provider
    log.info("AI provider resolved: %s (llm=%s)", provider.name, provider.is_llm)
    return provider


def reset_provider_cache() -> None:
    """Testing hook."""
    global _provider  # noqa: PLW0603
    _provider = None
