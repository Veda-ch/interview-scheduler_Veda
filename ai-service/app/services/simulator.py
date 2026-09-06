"""Schedule Digital Twin - Monte-Carlo disruption simulation.

What this is: a transparent stochastic model. Each iteration samples whether
each known disruption occurs, using hazard rates derived from *observable
schedule properties* (panel utilisation, buffer size, how far out the slot is,
timezone spread, number of backups). It then measures the disruption in minutes
and whether the schedule could self-recover.

What this is NOT: a trained model. There is no learned parameter here. The
hazard rates below are stated assumptions, exposed in the API response so a
reviewer can see and challenge every number. That honesty is the point - a
resilience score you cannot interrogate is worthless.
"""
from __future__ import annotations

import random
import statistics
from datetime import datetime, timezone
from typing import Any

from ..schemas import ScenarioOutcome, SimResult, SimSchedule, SimulateRequest, SimulateResponse

# --------------------------------------------------------------------------- #
# Stated assumptions (base rates per interview, before schedule-specific
# adjustment). Sourced from commonly reported recruiting-ops ranges and clearly
# labelled as assumptions rather than measurements.
# --------------------------------------------------------------------------- #
BASE_HAZARDS: dict[str, dict[str, Any]] = {
    "INTERVIEW_OVERRUN_5": {"base": 0.30, "impact": 5, "recoverable": True, "label": "Interview overruns by 5 minutes"},
    "INTERVIEW_OVERRUN_15": {"base": 0.12, "impact": 15, "recoverable": True, "label": "Interview overruns by 15 minutes"},
    "CANDIDATE_LATE": {"base": 0.08, "impact": 8, "recoverable": True, "label": "Candidate joins late"},
    "INTERVIEWER_CANCELS": {"base": 0.06, "impact": 60, "recoverable": True, "label": "Interviewer cancels"},
    "CANDIDATE_CANCELS": {"base": 0.04, "impact": 90, "recoverable": False, "label": "Candidate cancels"},
    "MEETING_SERVICE_FAILURE": {"base": 0.02, "impact": 10, "recoverable": True, "label": "Meeting link fails"},
    "RESCHEDULE_REQUEST": {"base": 0.07, "impact": 120, "recoverable": True, "label": "Reschedule requested"},
}


def _adjusted_hazards(schedule: SimSchedule) -> dict[str, float]:
    """Turn schedule properties into per-scenario probabilities.

    Every adjustment is a monotone, explainable nudge:
      - heavier panel load  -> more cancellations and overruns
      - further out in time -> more cancellations and reschedules
      - wider timezone spread -> more lateness
      - larger panel        -> more chance that *someone* drops
    """
    load = statistics.fmean([p.utilization for p in schedule.panel]) if schedule.panel else 0.0
    days_out = max(schedule.days_out, 0.0)
    tz_spread = _tz_spread(schedule)
    panel_size = max(len(schedule.panel), 1)

    hazards: dict[str, float] = {}
    for key, meta in BASE_HAZARDS.items():
        p = float(meta["base"])

        if key.startswith("INTERVIEW_OVERRUN"):
            p *= 1.0 + load * 0.6
            # A generous buffer does not prevent an overrun, it absorbs it -
            # handled in the impact calculation, not the hazard.
        elif key == "INTERVIEWER_CANCELS":
            p *= 1.0 + load * 1.2 + days_out * 0.02
            p = 1.0 - (1.0 - p) ** panel_size  # any panellist may cancel
        elif key == "CANDIDATE_CANCELS":
            p *= 1.0 + days_out * 0.03
        elif key == "RESCHEDULE_REQUEST":
            p *= 1.0 + days_out * 0.04 + tz_spread * 0.02
        elif key == "CANDIDATE_LATE":
            p *= 1.0 + tz_spread * 0.05

        hazards[key] = min(p, 0.95)
    return hazards


def _tz_spread(schedule: SimSchedule) -> float:
    """Rough timezone spread proxy from distinct zone names (hours unknown here)."""
    zones = {p.timezone for p in schedule.panel} | {schedule.candidate_timezone}
    return max(0.0, float(len(zones) - 1) * 3.0)


def _recovery_probability(schedule: SimSchedule, scenario: str) -> float:
    """Chance the Control Tower can absorb this disruption without human help."""
    backups = max((p.backup_count for p in schedule.panel), default=0)
    if scenario == "INTERVIEWER_CANCELS":
        # Recovery = a qualified replacement exists and is free.
        return min(0.95, 0.25 + 0.2 * backups)
    if scenario in ("INTERVIEW_OVERRUN_5", "INTERVIEW_OVERRUN_15"):
        impact = BASE_HAZARDS[scenario]["impact"]
        return 1.0 if schedule.buffer_minutes >= impact else max(0.2, schedule.buffer_minutes / impact)
    if scenario == "MEETING_SERVICE_FAILURE":
        return 0.9  # regenerate the link
    if scenario == "CANDIDATE_LATE":
        return 1.0 if schedule.buffer_minutes >= 8 else 0.6
    if scenario == "RESCHEDULE_REQUEST":
        return 0.6
    return 0.0  # candidate cancellation is not something the system can undo


def simulate_schedule(schedule: SimSchedule, iterations: int, rng: random.Random) -> SimResult:
    hazards = _adjusted_hazards(schedule)
    counts: dict[str, int] = {k: 0 for k in hazards}
    recovered: dict[str, int] = {k: 0 for k in hazards}
    scenario_disruption: dict[str, list[float]] = {k: [] for k in hazards}
    per_iteration_disruption: list[float] = []

    for _ in range(iterations):
        total = 0.0
        for scenario, probability in hazards.items():
            if rng.random() >= probability:
                continue
            counts[scenario] += 1
            impact = float(BASE_HAZARDS[scenario]["impact"])

            # Buffer absorbs part of a timing overrun before it cascades.
            if scenario.startswith("INTERVIEW_OVERRUN") or scenario == "CANDIDATE_LATE":
                impact = max(0.0, impact - schedule.buffer_minutes * 0.8)

            if rng.random() < _recovery_probability(schedule, scenario):
                recovered[scenario] += 1
                impact *= 0.35  # recovered, but not free - people were notified
            else:
                # Unrecovered disruption cascades into downstream rounds.
                impact *= 1.0 + 0.5 * schedule.downstream_interviews

            scenario_disruption[scenario].append(impact)
            total += impact
        per_iteration_disruption.append(total)

    per_iteration_disruption.sort()
    mean_disruption = statistics.fmean(per_iteration_disruption) if per_iteration_disruption else 0.0
    p95 = (
        per_iteration_disruption[min(int(0.95 * len(per_iteration_disruption)), len(per_iteration_disruption) - 1)]
        if per_iteration_disruption
        else 0.0
    )

    total_events = sum(counts.values())
    total_recovered = sum(recovered.values())
    recovery_rate = (total_recovered / total_events) if total_events else 1.0

    # Resilience: 100 = never disrupted. 60 minutes of expected disruption per
    # interview is treated as the "fully degraded" reference point.
    resilience = max(0.0, 100.0 - (mean_disruption / 60.0) * 100.0)
    resilience = round(min(100.0, resilience * (0.8 + 0.2 * recovery_rate)), 1)

    scenarios = [
        ScenarioOutcome(
            scenario=BASE_HAZARDS[key]["label"],
            probability=round(hazards[key], 4),
            occurrences=counts[key],
            mean_disruption_minutes=round(statistics.fmean(scenario_disruption[key]), 2) if scenario_disruption[key] else 0.0,
            recovered_fraction=round(recovered[key] / counts[key], 3) if counts[key] else 1.0,
        )
        for key in hazards
    ]
    scenarios.sort(key=lambda s: s.mean_disruption_minutes * s.probability, reverse=True)

    worst = scenarios[0].scenario if scenarios else "none"

    return SimResult(
        id=schedule.id,
        resilience_score=resilience,
        mean_disruption=round(mean_disruption, 2),
        p95_disruption=round(p95, 2),
        recovery_rate=round(recovery_rate, 3),
        worst_scenario=worst,
        scenarios=scenarios,
    )


def simulate(payload: SimulateRequest) -> SimulateResponse:
    seed = payload.seed if payload.seed is not None else int(datetime.now(tz=timezone.utc).timestamp())
    rng = random.Random(seed)
    results = [simulate_schedule(s, payload.iterations, rng) for s in payload.schedules]
    return SimulateResponse(results=results, iterations=payload.iterations, seed=seed)


def assumptions() -> dict[str, Any]:
    """Exposed via the API so the model's assumptions are auditable, not hidden."""
    return {
        "method": "monte-carlo",
        "note": (
            "Hazard rates are stated assumptions, not learned parameters. No model is trained. "
            "Each rate is adjusted deterministically by observable schedule properties."
        ),
        "base_hazards": {
            k: {"base_probability": v["base"], "impact_minutes": v["impact"], "label": v["label"]}
            for k, v in BASE_HAZARDS.items()
        },
        "adjustments": [
            "panel utilisation increases overrun and cancellation rates",
            "days-out increases cancellation and reschedule rates",
            "timezone spread increases lateness",
            "panel size compounds the chance that any one panellist cancels",
            "buffer minutes absorb overrun impact rather than preventing it",
            "available backup interviewers raise the recovery probability",
        ],
    }
