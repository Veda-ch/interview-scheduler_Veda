"""Optimisation, simulation and health-scoring endpoints."""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from ..schemas import (
    HealthScoreRequest,
    HealthScoreResponse,
    SolveRequest,
    SolveResponse,
    SkillMatchRequest,
)
from ..services import health as health_service
from ..services import optimizer
from ..services.matching import match_skills_llm

log = logging.getLogger("ai.schedule")

router = APIRouter(tags=["scheduling"])


@router.post("/schedule/solve", response_model=SolveResponse)
def solve_schedule(payload: SolveRequest) -> SolveResponse:
    """Pick the best (slot, panel) assignment from a pre-validated feasible space."""
    try:
        return optimizer.solve(payload)
    except Exception as exc:  # noqa: BLE001 - never let a solver bug 500 the platform
        log.exception("CP-SAT solve failed")
        raise HTTPException(status_code=500, detail={"message": f"solver failure: {exc}"}) from exc


@router.post("/schedule/health", response_model=HealthScoreResponse)
def schedule_health(payload: HealthScoreRequest) -> HealthScoreResponse:
    """Explainable heuristic health score with a complete arithmetic breakdown."""
    return health_service.score(payload)


@router.post("/match/skills")
def skills(payload: SkillMatchRequest) -> dict:
    """Skill coverage for panel ranking - LLM judged, ontology fallback."""
    return {"ok": True, **match_skills_llm(payload.required, payload.offered)}
