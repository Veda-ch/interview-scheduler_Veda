"""Pydantic contracts.

Two jobs:
  1. Validate what the backend sends us (bad input -> 422, never a crash).
  2. Validate what the LLM returns. An LLM response is parsed into these models
     before it is allowed anywhere near a scheduling decision; if it fails
     validation we retry once and then fall back to a deterministic extractor.
"""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

InterviewType = Literal["TECHNICAL", "CODING", "SYSTEM_DESIGN", "MANAGERIAL", "HR"]
Seniority = Literal["JUNIOR", "MID", "SENIOR", "STAFF", "PRINCIPAL"]

# --------------------------------------------------------------------------- #
# LLM output schemas
# --------------------------------------------------------------------------- #


class WeightedSkill(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    weight: float = Field(default=0.8, ge=0.0, le=1.0)
    must_have: bool = True

    @field_validator("name")
    @classmethod
    def clean_name(cls, v: str) -> str:
        return v.strip()


class JdAnalysis(BaseModel):
    technical_skills: list[WeightedSkill] = Field(default_factory=list, max_length=40)
    soft_skills: list[WeightedSkill] = Field(default_factory=list, max_length=20)
    experience_min: float = Field(default=0, ge=0, le=50)
    experience_max: float = Field(default=10, ge=0, le=60)
    interview_type: InterviewType = "TECHNICAL"
    topics: list[str] = Field(default_factory=list, max_length=20)
    seniority: Seniority = "MID"
    summary: str = ""

    @field_validator("experience_max")
    @classmethod
    def max_ge_min(cls, v: float, info) -> float:
        lo = info.data.get("experience_min", 0)
        return max(v, lo)


class ResumeSkill(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    proficiency: int = Field(default=3, ge=1, le=5)
    evidence: str = ""


class ResumeAnalysis(BaseModel):
    skills: list[ResumeSkill] = Field(default_factory=list, max_length=60)
    years_experience: float = Field(default=0, ge=0, le=60)
    highlights: list[str] = Field(default_factory=list, max_length=10)
    summary: str = ""
    jd_match: Optional[dict[str, Any]] = None


class AvailabilityConstraints(BaseModel):
    days: list[str] = Field(default_factory=list, max_length=7)
    avoid_days: list[str] = Field(default_factory=list, max_length=7)
    start_time: str = "09:00"
    end_time: str = "18:00"
    unavailable_dates: list[str] = Field(default_factory=list, max_length=60)
    max_interviews_per_day: Optional[int] = Field(default=None, ge=1, le=6)
    notes: str = ""

    @field_validator("start_time", "end_time")
    @classmethod
    def valid_time(cls, v: str) -> str:
        parts = str(v).strip().split(":")
        try:
            hour = int(parts[0])
            minute = int(parts[1]) if len(parts) > 1 else 0
        except (ValueError, IndexError):
            raise ValueError("time must look like HH:MM")
        # Models routinely write end-of-day as "24:00" (and occasionally
        # "23:60"). Both mean midnight, so normalise rather than reject - a
        # rejection here throws away an otherwise correct parse.
        if hour == 24 and minute == 0:
            return "23:59"
        if minute == 60 and hour <= 23:
            hour, minute = hour + 1, 0
            if hour == 24:
                return "23:59"
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            raise ValueError("time out of range")
        return f"{hour:02d}:{minute:02d}"

    @field_validator("days", "avoid_days")
    @classmethod
    def valid_days(cls, v: list[str]) -> list[str]:
        allowed = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}
        return [d.strip().lower() for d in v if d.strip().lower() in allowed]


class FeedbackAnalysis(BaseModel):
    strengths: list[str] = Field(default_factory=list, max_length=15)
    skill_gaps: list[str] = Field(default_factory=list, max_length=15)
    recommended_topics: list[str] = Field(default_factory=list, max_length=10)
    sentiment: Literal["POSITIVE", "MIXED", "NEGATIVE"] = "MIXED"
    next_round_focus: list[str] = Field(default_factory=list, max_length=10)
    summary: str = ""


class GeneratedMessage(BaseModel):
    subject: str = Field(default="", max_length=200)
    body: str = Field(default="", max_length=4000)
    tone: str = "professional"
    generated_by: str = "llm"


# --------------------------------------------------------------------------- #
# Request bodies
# --------------------------------------------------------------------------- #


class TextRequest(BaseModel):
    text: str = Field(min_length=1, max_length=40000)


class JdRequest(TextRequest):
    pass


class ResumeRequest(TextRequest):
    jd_skills: list[dict[str, Any]] = Field(default_factory=list, max_length=60)


class AvailabilityRequest(TextRequest):
    timezone: str = "UTC"


class FeedbackRequest(BaseModel):
    comments: str = Field(default="", max_length=8000)
    ratings: dict[str, float] = Field(default_factory=dict)
    overall_rating: int = Field(default=3, ge=1, le=5)
    interview_type: str = "TECHNICAL"
    required_skills: list[str] = Field(default_factory=list, max_length=40)


class MessageRequest(BaseModel):
    template_type: str = "INTERVIEW_SCHEDULED"
    context: dict[str, Any] = Field(default_factory=dict)
    tone: str = "professional"


class SkillMatchRequest(BaseModel):
    required: list[dict[str, Any]] = Field(default_factory=list, max_length=60)
    offered: list[dict[str, Any]] = Field(default_factory=list, max_length=120)


def _as_rounded_int(v: Any) -> Any:
    """Accept 83.6 (or "84") where the contract says an integer.

    Models answer with fractions all the time. Rejecting a correct judgement
    over its notation throws the whole answer away and silently drops us onto
    the deterministic fallback - the validator is the bug in that case, not the
    model. Anything genuinely non-numeric is passed through untouched so the
    normal validation error still fires.
    """
    if isinstance(v, bool):
        return v
    if isinstance(v, float):
        return int(round(v))
    if isinstance(v, str):
        try:
            return int(round(float(v.strip())))
        except (TypeError, ValueError):
            return v
    return v


class SkillCoverage(BaseModel):
    """The model's judgement on one required skill."""

    required: str = ""
    covered_by: str = ""
    coverage: int = Field(default=0, ge=0, le=100)
    reason: str = ""

    @field_validator("coverage", mode="before")
    @classmethod
    def round_coverage(cls, v: Any) -> Any:
        return _as_rounded_int(v)


class SkillMatchAnalysis(BaseModel):
    """LLM assessment of how well an interviewer covers a role's requirements."""

    overall: int = Field(default=0, ge=0, le=100)
    per_skill: list[SkillCoverage] = Field(default_factory=list, max_length=60)
    unmet_must_haves: list[str] = Field(default_factory=list, max_length=30)
    summary: str = ""

    @field_validator("overall", mode="before")
    @classmethod
    def round_overall(cls, v: Any) -> Any:
        return _as_rounded_int(v)


# --------------------------------------------------------------------------- #
# Scheduling / simulation
# --------------------------------------------------------------------------- #


class SolverSlot(BaseModel):
    index: int
    start_utc: str
    end_utc: str
    eligible_interviewers: list[str]
    candidate_preferred: bool = False
    local_start_minute_candidate: int = 540
    days_out: float = 0.0


class SolverInterviewer(BaseModel):
    id: str
    match_score: float = 0.0
    utilization: float = 0.0
    timezone: str = "UTC"
    max_per_day: int = 3


class SolverRequestMeta(BaseModel):
    id: str = ""
    duration_minutes: int = 60
    panel_size: int = Field(default=1, ge=1, le=6)
    buffer_minutes: int = 15
    candidate_timezone: str = "UTC"
    candidate_preferred_start_minute: int = 540
    candidate_preferred_end_minute: int = 1200


class SolveRequest(BaseModel):
    request: SolverRequestMeta
    slots: list[SolverSlot] = Field(max_length=1000)
    interviewers: list[SolverInterviewer] = Field(max_length=200)
    weights: dict[str, float] = Field(default_factory=dict)
    max_proposals: int = Field(default=5, ge=1, le=20)


class SolvedProposal(BaseModel):
    slot_index: int
    interviewer_ids: list[str]
    objective_value: float
    rank: int


class SolveResponse(BaseModel):
    proposals: list[SolvedProposal]
    solver_status: str
    solve_time_ms: float
    feasible_slot_count: int
    engine: str = "ortools-cpsat"


class SimPanelMember(BaseModel):
    id: str
    utilization: float = 0.0
    timezone: str = "UTC"
    backup_count: int = 0




class HealthScoreRequest(BaseModel):
    start_utc: str
    end_utc: str
    buffer_minutes: int = 15
    panel_utilizations: list[float] = Field(default_factory=list)
    timezone_spread_hours: float = 0.0
    candidate_local_start_minute: int = 540
    days_out: float = 0.0
    downstream_interviews: int = 0
    panel_size: int = 1
    backup_interviewer_count: int = 0
    nearest_gap_minutes: float = 60.0
    unconfirmed_participants: int = 0


class HealthScoreResponse(BaseModel):
    health_score: float
    conflict_risk: float
    cascade_risk: float
    interviewer_load: float
    candidate_inconvenience: float
    waiting_risk: float
    timezone_risk: float
    buffer_quality: float
    breakdown: dict[str, Any]
    method: str = "explainable-heuristic"
