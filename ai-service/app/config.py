"""Configuration for the AI + optimization service.

Every secret comes from the environment (loaded from the monorepo root .env).
Nothing is hardcoded, and the service starts successfully with no keys at all -
it simply reports `provider=mock` and serves deterministic results.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(REPO_ROOT / ".env")


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "") or default)
    except ValueError:
        return default


def _bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


class Settings:
    """Immutable-ish settings object; instantiated once via get_settings()."""

    def __init__(self) -> None:
        self.host = os.getenv("AI_SERVICE_HOST", "127.0.0.1")
        self.port = _int("AI_SERVICE_PORT", 8000)
        self.service_token = os.getenv("AI_SERVICE_TOKEN", "dev-shared-service-token")
        self.require_token = _bool("AI_SERVICE_REQUIRE_TOKEN", True)

        # ai provider: mock | gemini | ollama
        self.ai_provider = (os.getenv("AI_PROVIDER", "mock") or "mock").lower()
        self.gemini_api_key = os.getenv("GEMINI_API_KEY", "")
        self.gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
        self.ollama_base_url = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
        self.ollama_model = os.getenv("OLLAMA_MODEL", "llama3.1")

        # embeddings: local | sentence-transformers
        self.embedding_provider = (os.getenv("EMBEDDING_PROVIDER", "local") or "local").lower()
        self.embedding_model = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")

        self.llm_timeout_seconds = _int("AI_LLM_TIMEOUT_SECONDS", 25)
        self.llm_max_retries = _int("AI_LLM_MAX_RETRIES", 1)

        self.solver_time_limit_seconds = float(os.getenv("SOLVER_TIME_LIMIT_SECONDS", "5"))
        self.simulation_iterations = _int("SIMULATION_ITERATIONS", 200)
        self.simulation_max_iterations = _int("SIMULATION_MAX_ITERATIONS", 5000)

        self.cors_origins = [
            o.strip() for o in os.getenv("CORS_ORIGIN", "http://localhost:5173").split(",") if o.strip()
        ]

    @property
    def gemini_configured(self) -> bool:
        return bool(self.gemini_api_key)

    def describe(self) -> dict:
        """What the /health endpoint reports - never includes secret values."""
        return {
            "ai_provider": self.ai_provider,
            "gemini_configured": self.gemini_configured,
            "embedding_provider": self.embedding_provider,
            "embedding_model": self.embedding_model,
            "solver_time_limit_seconds": self.solver_time_limit_seconds,
            "simulation_iterations": self.simulation_iterations,
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
