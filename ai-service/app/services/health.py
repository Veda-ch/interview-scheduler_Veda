"""Schedule health score - an explainable heuristic (NOT a prediction).

Seven components, each 0..100 and each derived from one observable property of
the schedule. The overall score is their weighted mean. Every number that goes
into it is returned in `breakdown`, so the UI can show the arithmetic rather
than a mysterious "93".

health_score is a deterministic heuristic computed here. It is not a
prediction, not a model output, and is never described as one.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from ..schemas import HealthScoreRequest, HealthScoreResponse

WEIGHTS = {
    "conflict": 0.20,
    "cascade": 0.18,
    "load": 0.16,
    "buffer": 0.16,
    "timezone": 0.12,
    "candidate": 0.10,
    "waiting": 0.08,
}


def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


def score(payload: HealthScoreRequest) -> HealthScoreResponse:
    avg_load = (
        sum(payload.panel_utilizations) / len(payload.panel_utilizations)
        if payload.panel_utilizations
        else 0.0
    )
    max_load = max(payload.panel_utilizations, default=0.0)

    # --- Conflict risk: how likely is this slot to collide with something else?
    # Driven by how tight the surrounding gap is and how loaded the panel is.
    gap_ratio = min(payload.nearest_gap_minutes / max(payload.buffer_minutes * 2, 30), 1.0)
    conflict_risk = _clamp((1 - gap_ratio) * 60 + max_load * 40)

    # --- Cascade risk: if this slips, how much else moves?
    cascade_risk = _clamp(
        payload.downstream_interviews * 18
        + max(0.0, payload.panel_size - 1) * 10
        + (0 if payload.backup_interviewer_count > 0 else 25)
        + payload.unconfirmed_participants * 8
    )

    # --- Interviewer load: proportion of declared capacity already used.
    interviewer_load = _clamp(avg_load * 100)

    # --- Buffer quality: is the protective gap actually there?
    buffer_quality = _clamp(gap_ratio * 100)

    # --- Timezone risk: spread between participants.
    timezone_risk = _clamp(min(payload.timezone_spread_hours, 12) / 12 * 100)

    # --- Candidate inconvenience: how civil is the local start time for them?
    m = payload.candidate_local_start_minute
    if 540 <= m <= 1020:          # 09:00-17:00
        candidate_inconvenience = 0.0
    elif 480 <= m <= 1140:        # 08:00-19:00
        candidate_inconvenience = 25.0
    elif 420 <= m <= 1260:        # 07:00-21:00
        candidate_inconvenience = 55.0
    else:
        candidate_inconvenience = 90.0

    # --- Waiting risk: candidates disengage the longer the gap to the interview.
    waiting_risk = _clamp(max(0.0, payload.days_out - 3) * 9)

    health = (
        (100 - conflict_risk) * WEIGHTS["conflict"]
        + (100 - cascade_risk) * WEIGHTS["cascade"]
        + (100 - interviewer_load) * WEIGHTS["load"]
        + buffer_quality * WEIGHTS["buffer"]
        + (100 - timezone_risk) * WEIGHTS["timezone"]
        + (100 - candidate_inconvenience) * WEIGHTS["candidate"]
        + (100 - waiting_risk) * WEIGHTS["waiting"]
    )

    breakdown: dict[str, Any] = {
        "weights": WEIGHTS,
        "inputs": {
            "buffer_minutes": payload.buffer_minutes,
            "nearest_gap_minutes": payload.nearest_gap_minutes,
            "average_panel_utilization": round(avg_load, 3),
            "max_panel_utilization": round(max_load, 3),
            "panel_size": payload.panel_size,
            "backup_interviewer_count": payload.backup_interviewer_count,
            "downstream_interviews": payload.downstream_interviews,
            "unconfirmed_participants": payload.unconfirmed_participants,
            "timezone_spread_hours": payload.timezone_spread_hours,
            "candidate_local_start_minute": payload.candidate_local_start_minute,
            "days_out": round(payload.days_out, 2),
        },
        "components": {
            "conflict_risk": round(conflict_risk, 1),
            "cascade_risk": round(cascade_risk, 1),
            "interviewer_load": round(interviewer_load, 1),
            "buffer_quality": round(buffer_quality, 1),
            "timezone_risk": round(timezone_risk, 1),
            "candidate_inconvenience": round(candidate_inconvenience, 1),
            "waiting_risk": round(waiting_risk, 1),
        },
        "explanations": _explain(
            conflict_risk, cascade_risk, interviewer_load, buffer_quality,
            timezone_risk, candidate_inconvenience, waiting_risk, payload,
        ),
        "computed_at": datetime.utcnow().isoformat() + "Z",
    }

    return HealthScoreResponse(
        health_score=round(_clamp(health), 1),
        conflict_risk=round(conflict_risk, 1),
        cascade_risk=round(cascade_risk, 1),
        interviewer_load=round(interviewer_load, 1),
        candidate_inconvenience=round(candidate_inconvenience, 1),
        waiting_risk=round(waiting_risk, 1),
        timezone_risk=round(timezone_risk, 1),
        buffer_quality=round(buffer_quality, 1),
        breakdown=breakdown,
    )


def _explain(conflict, cascade, load, buffer_q, tz, cand, waiting, payload) -> list[str]:
    out: list[str] = []
    out.append(
        f"Conflict risk {conflict:.0f}/100 - nearest free-space margin is "
        f"{payload.nearest_gap_minutes:.0f} min against a {payload.buffer_minutes} min buffer."
    )
    out.append(
        f"Cascade risk {cascade:.0f}/100 - {payload.downstream_interviews} downstream round(s), "
        f"{payload.backup_interviewer_count} qualified backup interviewer(s) available."
    )
    out.append(f"Interviewer load {load:.0f}% of declared weekly capacity.")
    out.append(
        "Buffer quality good." if buffer_q >= 75 else
        "Buffer quality acceptable." if buffer_q >= 45 else
        "Buffer is tight - an overrun would immediately hit the next commitment."
    )
    out.append(
        "All participants share a timezone." if tz == 0 else
        f"Timezone spread {payload.timezone_spread_hours:.1f}h across participants."
    )
    hour = payload.candidate_local_start_minute // 60
    out.append(
        f"Candidate starts at {hour:02d}:{payload.candidate_local_start_minute % 60:02d} local - "
        + ("comfortable." if cand == 0 else "outside core hours." if cand < 60 else "very inconvenient.")
    )
    out.append(
        f"Interview is {payload.days_out:.1f} days out - "
        + ("short waiting time." if waiting < 20 else "long wait raises drop-off risk.")
    )
    return out
