"""LLM-backed endpoints.

Every handler follows the same contract:
    prompt -> provider -> extract JSON -> validate (Pydantic) -> retry once ->
    deterministic fallback

and returns a `ProviderMeta` block saying exactly which path produced the answer.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter

from ..providers.base import structured_call
from ..providers.llm_providers import get_provider
from ..config import get_settings
from ..schemas import (
    AvailabilityConstraints,
    AvailabilityRequest,
    FeedbackAnalysis,
    FeedbackRequest,
    GeneratedMessage,
    MessageRequest,
    SkillMatchRequest,
)
from ..services import extractors
from ..services.matching import match_skills_llm

log = logging.getLogger("ai.router")
router = APIRouter(prefix="/ai", tags=["ai"])


def _envelope(result, meta: dict, extra: dict | None = None) -> dict:
    """Uniform response so the backend can label AI-derived data honestly."""
    return {
        "ok": True,
        "result": result.model_dump() if hasattr(result, "model_dump") else result,
        "provider": "deterministic" if meta.get("fallback_used") or not meta.get("used_llm") else meta["provider"],
        "used_llm": bool(meta.get("used_llm")) and not meta.get("fallback_used"),
        "fallback_used": bool(meta.get("fallback_used")),
        "attempts": meta.get("attempts", 0),
        "warning": meta.get("warning"),
        **(extra or {}),
    }


@router.post("/parse-availability")
def parse_availability(payload: AvailabilityRequest) -> dict:
    prompt = (
        "Convert this candidate's free-text availability into structured constraints. "
        "Times are in the candidate's local timezone "
        f"({payload.timezone}), 24-hour HH:MM. days = days they ARE available; "
        "avoid_days = days they explicitly ruled out. "
        "max_interviews_per_day only if they state a limit.\n\n"
        f"AVAILABILITY TEXT:\n{payload.text[:2000]}"
    )
    result, meta = structured_call(
        get_provider(), prompt, AvailabilityConstraints,
        fallback=lambda: extractors.extract_availability(payload.text),
        max_retries=get_settings().llm_max_retries,
    )
    # Guard rail: a model that returns days it was also told to avoid is wrong.
    result.days = [d for d in result.days if d not in result.avoid_days]
    if not result.days:
        result.days = [d for d in extractors.WEEKDAYS if d not in result.avoid_days]
    return _envelope(result, meta, {"timezone": payload.timezone})


@router.post("/analyze-feedback")
def analyze_feedback(payload: FeedbackRequest) -> dict:
    prompt = (
        "Analyse this interview feedback. Identify demonstrated strengths, concrete "
        "skill gaps, and the topics the NEXT interview round should probe. "
        "Only list skills actually discussed in the feedback. "
        "sentiment is POSITIVE, MIXED or NEGATIVE.\n\n"
        f"INTERVIEW TYPE: {payload.interview_type}\n"
        f"STRUCTURED RATINGS (1-5): {payload.ratings}\n"
        f"OVERALL: {payload.overall_rating}/5\n"
        f"COMMENTS:\n{payload.comments[:6000]}"
    )
    result, meta = structured_call(
        get_provider(), prompt, FeedbackAnalysis,
        fallback=lambda: extractors.extract_feedback(payload.model_dump()),
        max_retries=get_settings().llm_max_retries,
    )
    if not result.next_round_focus:
        result.next_round_focus = result.recommended_topics[:6]
    # Smaller local models reliably fill the lists but often leave `summary`
    # blank. Compose one from their own findings rather than showing the
    # recruiter an empty field.
    if not result.summary.strip():
        result.summary = (
            f"{len(result.strengths)} strength(s), {len(result.skill_gaps)} gap(s); "
            f"overall rating {payload.overall_rating}/5."
        )
    return _envelope(result, meta)


@router.post("/generate-message")
def generate_message(payload: MessageRequest) -> dict:
    ctx = payload.context or {}
    prompt = (
        "Write a short, warm, professional interview notification email. "
        f"Tone: {payload.tone}. Type: {payload.template_type}. "
        "Keep it under 140 words, no placeholders left unfilled, no markdown. "
        "Never invent times, names or links that are not in the context.\n\n"
        f"CONTEXT (use only these facts):\n{ctx}"
    )
    result, meta = structured_call(
        get_provider(), prompt, GeneratedMessage,
        fallback=lambda: extractors.render_message(payload.template_type, ctx),
        max_retries=get_settings().llm_max_retries,
    )
    if not result.body.strip():
        result = extractors.render_message(payload.template_type, ctx)
        meta["fallback_used"] = True
        meta["warning"] = "model returned an empty body"
    return _envelope(result, meta)


@router.post("/skill-match")
def skill_match(payload: SkillMatchRequest) -> dict:
    """LLM skill-coverage judgement (deterministic ontology matcher as fallback)."""
    return {"ok": True, **match_skills_llm(payload.required, payload.offered)}
