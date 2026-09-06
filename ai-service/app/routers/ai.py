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
    JdAnalysis,
    JdRequest,
    MessageRequest,
    ResumeAnalysis,
    ResumeRequest,
    SkillMatchRequest,
)
from ..services import extractors
from ..services.matching import match_skills

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


@router.post("/analyze-jd")
def analyze_jd(payload: JdRequest) -> dict:
    prompt = (
        "You are parsing a software-engineering job description for an interview "
        "scheduling system. Extract the required skills and interview metadata.\n"
        "Rules: use canonical technology names (e.g. 'Spring Boot', not 'springboot'). "
        "must_have=true only for skills the JD lists as required. "
        "interview_type must be one of TECHNICAL, CODING, SYSTEM_DESIGN, MANAGERIAL, HR.\n\n"
        f"JOB DESCRIPTION:\n{payload.text[:8000]}"
    )
    result, meta = structured_call(
        get_provider(), prompt, JdAnalysis,
        fallback=lambda: extractors.extract_jd(payload.text),
        max_retries=get_settings().llm_max_retries,
    )
    return _envelope(result, meta)


@router.post("/analyze-resume")
def analyze_resume(payload: ResumeRequest) -> dict:
    prompt = (
        "Extract structured skill data from this resume for an interview scheduling "
        "system. proficiency is 1-5 based on evidence of depth in the text. "
        "Use canonical technology names. Do not invent skills that are not present.\n\n"
        f"RESUME:\n{payload.text[:12000]}"
    )
    result, meta = structured_call(
        get_provider(), prompt, ResumeAnalysis,
        fallback=lambda: extractors.extract_resume(payload.text, payload.jd_skills),
        max_retries=get_settings().llm_max_retries,
    )
    # JD comparison is always deterministic - an LLM must not invent a match score.
    if payload.jd_skills:
        result.jd_match = extractors.score_skill_match(
            payload.jd_skills, [s.model_dump() for s in result.skills]
        )
    return _envelope(result, meta, {"jd_match_method": "deterministic"})


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
    """Deterministic + embedding-assisted; deliberately never an LLM call."""
    return {"ok": True, **match_skills(payload.required, payload.offered)}
