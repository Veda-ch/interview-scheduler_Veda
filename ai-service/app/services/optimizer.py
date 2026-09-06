"""Constraint optimisation over the feasible interview space (OR-Tools CP-SAT).

The backend has already proved every candidate slot legal (availability,
working hours, buffers, per-day caps). This module answers the *optimisation*
question: which single (slot, panel) assignment maximises the weighted soft
objective, and what are the best distinct alternatives?

Model
-----
Boolean vars:
  x[s]      slot s is chosen
  y[s][i]   interviewer i staffs slot s

Constraints:
  sum_s x[s] == 1                      exactly one slot is chosen
  sum_i y[s][i] == panel_size * x[s]   the chosen slot gets a full panel
  y[s][i] <= x[s]                      no staffing an unchosen slot
  y[s][i] == 0 for ineligible i        eligibility is a hard constraint

Objective (maximised, integer-scaled):
  panel skill + candidate preference + buffer/earliness + workload balance
  + timezone comfort

Alternatives are produced by re-solving with a no-good cut forbidding each
previously chosen slot, which yields genuinely different options rather than
near-duplicates of one solution.
"""
from __future__ import annotations

import logging
import time
from typing import Any

from ortools.sat.python import cp_model

from ..config import get_settings
from ..schemas import SolveRequest, SolveResponse, SolvedProposal

log = logging.getLogger("ai.optimizer")

SCALE = 1000  # CP-SAT is integer-only; scale the float objective.

DEFAULT_WEIGHTS = {
    "panelSkill": 0.30,
    "candidatePreference": 0.20,
    "bufferQuality": 0.15,
    "workloadBalance": 0.15,
    "timezoneComfort": 0.10,
    "earliness": 0.10,
}


def _slot_static_score(slot, weights: dict[str, float]) -> float:
    """Slot-only contribution (independent of which interviewers are picked)."""
    pref = 100.0 if slot.candidate_preferred else 60.0
    # Civil-hour comfort on the candidate's own clock.
    m = slot.local_start_minute_candidate
    if 540 <= m <= 1020:
        tz_comfort = 100.0
    elif 480 <= m <= 1140:
        tz_comfort = 75.0
    else:
        tz_comfort = 35.0
    earliness = max(0.0, 100.0 - slot.days_out * 7.0)

    return (
        pref * weights["candidatePreference"]
        + tz_comfort * weights["timezoneComfort"]
        + earliness * weights["earliness"]
        # Buffer quality is slot-shaped in the backend's scorer; here we give a
        # neutral constant so the two engines rank the same space consistently.
        + 70.0 * weights["bufferQuality"]
    )


def _interviewer_score(iv, weights: dict[str, float], panel_size: int) -> float:
    """Per-interviewer contribution, divided by panel size so panels compare fairly."""
    workload = max(0.0, 1.0 - iv.utilization) * 100.0
    return (iv.match_score * weights["panelSkill"] + workload * weights["workloadBalance"]) / max(panel_size, 1)


def solve(payload: SolveRequest) -> SolveResponse:
    settings = get_settings()
    started = time.perf_counter()

    weights = {**DEFAULT_WEIGHTS, **(payload.weights or {})}
    panel_size = payload.request.panel_size
    slots = payload.slots
    interviewers = {iv.id: iv for iv in payload.interviewers}

    if not slots:
        return SolveResponse(
            proposals=[], solver_status="NO_SLOTS", solve_time_ms=0.0, feasible_slot_count=0
        )

    # Slots that cannot be fully staffed are dropped before the model is built.
    usable = [s for s in slots if len([i for i in s.eligible_interviewers if i in interviewers]) >= panel_size]
    if not usable:
        return SolveResponse(
            proposals=[],
            solver_status="INFEASIBLE_PANEL",
            solve_time_ms=(time.perf_counter() - started) * 1000,
            feasible_slot_count=0,
        )

    slot_static = {s.index: _slot_static_score(s, weights) for s in usable}
    iv_score = {iid: _interviewer_score(iv, weights, panel_size) for iid, iv in interviewers.items()}

    proposals: list[SolvedProposal] = []
    banned_slots: set[int] = set()
    status_name = "UNKNOWN"

    for rank in range(payload.max_proposals):
        pool = [s for s in usable if s.index not in banned_slots]
        if not pool:
            break

        model = cp_model.CpModel()
        x: dict[int, Any] = {}
        y: dict[tuple[int, str], Any] = {}

        for s in pool:
            x[s.index] = model.NewBoolVar(f"x_{s.index}")
            eligible = [i for i in s.eligible_interviewers if i in interviewers]
            for iid in eligible:
                y[(s.index, iid)] = model.NewBoolVar(f"y_{s.index}_{iid}")

            # Panel is fully staffed iff the slot is chosen.
            model.Add(sum(y[(s.index, iid)] for iid in eligible) == panel_size * x[s.index])
            for iid in eligible:
                model.Add(y[(s.index, iid)] <= x[s.index])

        model.Add(sum(x.values()) == 1)

        objective = []
        for s in pool:
            objective.append(int(slot_static[s.index] * SCALE) * x[s.index])
            for iid in s.eligible_interviewers:
                if iid in interviewers:
                    objective.append(int(iv_score[iid] * SCALE) * y[(s.index, iid)])
        model.Maximize(sum(objective))

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = settings.solver_time_limit_seconds
        solver.parameters.num_search_workers = 4
        status = solver.Solve(model)
        status_name = solver.StatusName(status)

        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            break

        chosen_slot = next((s.index for s in pool if solver.Value(x[s.index]) == 1), None)
        if chosen_slot is None:
            break

        chosen_panel = [
            iid
            for (sidx, iid), var in y.items()
            if sidx == chosen_slot and solver.Value(var) == 1
        ]
        proposals.append(
            SolvedProposal(
                slot_index=chosen_slot,
                interviewer_ids=sorted(chosen_panel),
                objective_value=round(solver.ObjectiveValue() / SCALE, 2),
                rank=rank + 1,
            )
        )
        # No-good cut: the next solution must use a different slot.
        banned_slots.add(chosen_slot)

    return SolveResponse(
        proposals=proposals,
        solver_status=status_name,
        solve_time_ms=round((time.perf_counter() - started) * 1000, 2),
        feasible_slot_count=len(usable),
    )
