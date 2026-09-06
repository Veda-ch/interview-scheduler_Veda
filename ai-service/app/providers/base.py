"""AIProvider interface + the shared JSON-repair / validate / retry pipeline.

The contract every provider implements is a single method:

    complete_json(prompt, schema_hint) -> str      (raw model text)

Everything above it - extracting JSON from prose, validating against a Pydantic
model, retrying once with a stricter instruction, and finally falling back to a
deterministic extractor - lives here so all providers behave identically.
"""
from __future__ import annotations

import json
import logging
import re
from abc import ABC, abstractmethod
from typing import Any, Callable, TypeVar

from pydantic import BaseModel, ValidationError

log = logging.getLogger("ai.provider")

T = TypeVar("T", bound=BaseModel)


class LlmUnavailable(RuntimeError):
    """Raised when the model cannot be reached at all."""


class AIProvider(ABC):
    name: str = "base"
    #: True when this provider actually calls a language model.
    is_llm: bool = False

    @abstractmethod
    def complete_json(self, prompt: str, schema_hint: str) -> str:
        """Return raw model output that should contain a JSON object."""

    def available(self) -> bool:
        return True


_JSON_BLOCK = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)


def extract_json(raw: str) -> dict[str, Any]:
    """Pull the first JSON object out of a model response.

    Models wrap JSON in prose or fences more often than not, so we try, in order:
    fenced block -> whole string -> first balanced {...} span.
    """
    if not raw:
        raise ValueError("empty response")

    match = _JSON_BLOCK.search(raw)
    if match:
        return json.loads(match.group(1))

    stripped = raw.strip()
    try:
        parsed = json.loads(stripped)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    start = stripped.find("{")
    if start == -1:
        raise ValueError("no JSON object in response")

    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(stripped)):
        ch = stripped[i]
        if escape:
            escape = False
            continue
        if ch == "\\":
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(stripped[start : i + 1])
    raise ValueError("unbalanced JSON object in response")


def structured_call(
    provider: AIProvider,
    prompt: str,
    model_cls: type[T],
    fallback: Callable[[], T],
    *,
    max_retries: int = 1,
) -> tuple[T, dict[str, Any]]:
    """Run an LLM call and guarantee a valid `model_cls` instance comes back.

    Returns (result, meta) where meta records exactly what happened, so the API
    response can be honest about whether a model or a fallback produced the data.
    """
    meta: dict[str, Any] = {
        "provider": provider.name,
        "used_llm": provider.is_llm,
        "fallback_used": False,
        "attempts": 0,
        "warning": None,
    }

    if not provider.is_llm or not provider.available():
        result = fallback()
        meta["fallback_used"] = not provider.is_llm
        return result, meta

    schema_hint = json.dumps(model_cls.model_json_schema().get("properties", {}), indent=2)[:2000]
    attempt_prompt = prompt

    last_error: str | None = None
    for attempt in range(max_retries + 1):
        meta["attempts"] = attempt + 1
        try:
            raw = provider.complete_json(attempt_prompt, schema_hint)
            payload = extract_json(raw)
            return model_cls.model_validate(payload), meta
        except (ValidationError, ValueError, json.JSONDecodeError) as exc:
            last_error = f"{type(exc).__name__}: {str(exc)[:300]}"
            log.warning("LLM returned unusable output (attempt %s): %s", attempt + 1, last_error)
            # Retry once, telling the model precisely what went wrong.
            attempt_prompt = (
                f"{prompt}\n\nYour previous reply could not be parsed ({last_error}). "
                "Reply with ONLY a single valid JSON object matching the schema. "
                "No prose, no markdown fences, no trailing commas."
            )
        except LlmUnavailable as exc:
            last_error = str(exc)[:300]
            log.warning("LLM unavailable: %s", last_error)
            break
        except Exception as exc:  # noqa: BLE001 - provider SDKs raise anything
            last_error = f"{type(exc).__name__}: {str(exc)[:300]}"
            log.warning("LLM call failed: %s", last_error)
            break

    meta["fallback_used"] = True
    meta["warning"] = last_error or "LLM output failed validation"
    return fallback(), meta
