"""Optimisation, simulation and health-scoring endpoints."""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from ..schemas import (
    HealthScoreRequest,
    HealthScoreResponse,
    SimulateRequest,
    SimulateResponse,
    SolveRequest,
    SolveResponse,
    SkillMatchRequest,
)
from ..services import health as health_service
from ..services import optimizer, simulator
from ..services.matching import match_skills

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


@router.post("/schedule/simulate", response_model=SimulateResponse)
def simulate_schedules(payload: SimulateRequest) -> SimulateResponse:
    """Monte-Carlo disruption simulation -> resilience score per schedule."""
    return simulator.simulate(payload)


@router.get("/schedule/simulation-assumptions")
def simulation_assumptions() -> dict:
    """Full disclosure of the simulator's stated (not learned) parameters."""
    return simulator.assumptions()


@router.post("/schedule/health", response_model=HealthScoreResponse)
def schedule_health(payload: HealthScoreRequest) -> HealthScoreResponse:
    """Explainable heuristic health score with a complete arithmetic breakdown."""
    return health_service.score(payload)


@router.post("/match/skills")
def skills(payload: SkillMatchRequest) -> dict:
    return {"ok": True, **match_skills(payload.required, payload.offered)}
