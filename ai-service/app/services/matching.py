"""Skill matching.

`match_skills_llm` is the primary path: deciding whether an interviewer's
"PostgreSQL" experience covers a "SQL" requirement is a judgement about meaning,
which is what a language model is for. It returns a per-skill breakdown with the
model's own reasoning so the recruiter can see why someone ranked where they did.

`match_skills` below it is the deterministic fallback, combining three signals in
decreasing order of trust:
  1. canonical identity   (ontology says these are the same skill)     -> 1.00
  2. ontology adjacency   ("SQL Optimization" is adjacent to "SQL")    -> 0.60
  3. embedding similarity (lexical by default, neural if installed)    -> <= 0.50

It runs whenever the model is unavailable or returns something unusable, so a
missing LLM degrades the explanation, never the ability to staff a panel.
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from collections import OrderedDict
from typing import Any

from ..providers.base import structured_call
from ..providers.embeddings import get_embedding_provider, semantic_skill_similarity
from ..providers.llm_providers import get_provider
from ..config import get_settings
from ..schemas import SkillMatchAnalysis
from .extractors import canonicalize

log = logging.getLogger("ai.matching")

# --------------------------------------------------------------------------- #
# Result cache
#
# Skill coverage is a pure function of (required, offered): the same two skill
# lists always deserve the same judgement. Ranking a panel calls this once per
# interviewer, and booking a round ranks more than once, so one request
# otherwise pays for the same judgement several times over - several seconds
# each against a local model.
#
# Only successful LLM answers are cached. A deterministic fallback is never
# stored, so a transient model outage cannot pin the rest of the session onto
# the lexical path.
# --------------------------------------------------------------------------- #
# A must-have the interviewer does not cover is disqualifying, not merely a
# deduction. Without a ceiling, someone who covers three adjacent skills well
# outscores someone who actually holds the role's core requirement: asked about
# a Java/Spring Boot role, the model judged "Python covers Spring Boot" at 80,
# which was enough to rank a data engineer above the backend engineer. Capping
# keeps anyone missing a must-have below anyone who has them all, while still
# recording the partial coverage they genuinely bring.
UNMET_MUST_HAVE_CEILING = 25.0

_CACHE_MAX = 512
_CACHE_TTL_SECONDS = 1800
_cache: OrderedDict[str, tuple[float, dict[str, Any]]] = OrderedDict()


def _cache_key(required: list[Any], offered: list[Any]) -> str:
    def norm_required(items: list[Any]) -> list[list[Any]]:
        out = []
        for it in items or []:
            if isinstance(it, dict):
                out.append([
                    canonicalize(it.get("name") or ""),
                    round(float(it.get("weight", 0.8) or 0.8), 3),
                    bool(it.get("mustHave", it.get("must_have", True))),
                ])
            else:
                out.append([canonicalize(str(it)), 0.8, True])
        return sorted(out, key=str)

    def norm_offered(items: list[Any]) -> list[list[Any]]:
        out = []
        for it in items or []:
            if isinstance(it, dict):
                out.append([canonicalize(it.get("name") or ""), it.get("proficiency"), it.get("years")])
            else:
                out.append([canonicalize(str(it)), None, None])
        return sorted(out, key=str)

    blob = json.dumps(
        {"required": norm_required(required), "offered": norm_offered(offered)},
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def match_skills_llm(required: list[dict[str, Any]], offered: list[dict[str, Any]]) -> dict[str, Any]:
    """Cached wrapper around the LLM skill-coverage judgement."""
    key = _cache_key(required, offered)
    now = time.monotonic()

    hit = _cache.get(key)
    if hit is not None:
        stored_at, value = hit
        if (now - stored_at) < _CACHE_TTL_SECONDS:
            _cache.move_to_end(key)
            return {**value, "cached": True}
        _cache.pop(key, None)

    result = _match_skills_llm_uncached(required, offered)

    if result.get("used_llm"):
        _cache[key] = (now, result)
        _cache.move_to_end(key)
        while len(_cache) > _CACHE_MAX:
            _cache.popitem(last=False)

    return {**result, "cached": False}


def clear_skill_match_cache() -> int:
    """Drop every cached judgement. Called when skills change underneath us."""
    n = len(_cache)
    _cache.clear()
    return n


def _describe(items: list[Any], keys: tuple[str, ...]) -> str:
    out: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            out.append(str(item))
            continue
        bits = [f"{item.get(k)}" for k in keys if item.get(k) not in (None, "")]
        out.append(" ".join(bits))
    return "; ".join(out)


def _match_skills_llm_uncached(required: list[dict[str, Any]], offered: list[dict[str, Any]]) -> dict[str, Any]:
    """LLM skill-coverage judgement, with the deterministic matcher as fallback.

    The return shape is identical to `match_skills` so every caller works
    unchanged; extra keys report which path produced the answer.
    """
    required = required or []
    offered = offered or []

    deterministic = lambda: match_skills(required, offered)  # noqa: E731

    if not required:
        det = deterministic()
        return {**det, "used_llm": False, "provider": "deterministic", "fallback_used": False, "warning": None}

    prompt = (
        "You are assessing whether an interviewer is qualified to assess a "
        "candidate for a role. For EACH required skill, decide how well the "
        "interviewer's own skills cover it.\n"
        "coverage is 0-100: 100 = the same skill or clearly deeper; 60-90 = "
        "closely adjacent (e.g. 'PostgreSQL' covers 'SQL'); 1-40 = loosely "
        "related; 0 = not covered at all. covered_by is the interviewer skill "
        "you matched it to, or an empty string when nothing covers it. Put any "
        "must-have requirement scoring under 50 in unmet_must_haves. overall is "
        "the weighted 0-100 result across all requirements. Judge only from the "
        "skills listed - never assume knowledge that is not written down.\n\n"
        f"REQUIRED BY THE ROLE (name, weight, must_have):\n"
        f"{_describe(required, ('name', 'weight', 'mustHave'))}\n\n"
        f"INTERVIEWER'S DECLARED SKILLS (name, proficiency out of 5, years):\n"
        f"{_describe(offered, ('name', 'proficiency', 'years'))}"
    )

    def _fallback() -> SkillMatchAnalysis:
        det = deterministic()
        return SkillMatchAnalysis(
            overall=int(round(det["overall"])),
            per_skill=[
                {
                    "required": p["skill"],
                    "covered_by": p.get("matched_with") or "",
                    "coverage": int(round(p["score"])),
                    "reason": det["method"],
                }
                for p in det["per_skill"]
            ],
            unmet_must_haves=det["unmet_must_haves"],
            summary="Deterministic ontology and lexical similarity.",
        )

    result, meta = structured_call(
        get_provider(), prompt, SkillMatchAnalysis,
        fallback=_fallback,
        max_retries=get_settings().llm_max_retries,
    )

    used_llm = bool(meta.get("used_llm")) and not meta.get("fallback_used")

    # The model is trusted for ONE thing: judging whether an offered skill covers
    # a required one. Everything downstream of that - the weighted total, which
    # must-haves are unmet - is arithmetic we do ourselves.
    #
    # This is not pedantry. Asked directly, the model has returned an `overall`
    # of 73 while simultaneously reporting both must-have skills unmet, which
    # would rank an unqualified interviewer alongside a qualified one. Recomputing
    # the total from its own per-skill judgements keeps the ranking coherent.
    by_name = {
        canonicalize(p.required): p
        for p in result.per_skill
        if (p.required or "").strip()
    }

    per_skill: list[dict[str, Any]] = []
    unmet: list[str] = []
    weighted_sum = 0.0
    weight_total = 0.0

    for idx, req in enumerate(required):
        raw = req.get("name") if isinstance(req, dict) else req
        name = canonicalize(raw)
        if not name:
            continue
        weight = float(req.get("weight", 0.8)) if isinstance(req, dict) else 0.8
        must = bool(req.get("mustHave", req.get("must_have", True))) if isinstance(req, dict) else True
        if must:
            weight = max(weight, 0.9)

        # Prefer a name match; fall back to positional when the model omitted the
        # name (small local models frequently do).
        judged = by_name.get(name)
        if judged is None and idx < len(result.per_skill):
            candidate = result.per_skill[idx]
            if not (candidate.required or "").strip():
                judged = candidate

        coverage = float(max(0, min(100, judged.coverage))) if judged else 0.0
        matched = (judged.covered_by or "").strip() if judged else ""

        if must and coverage < 50:
            unmet.append(name)

        per_skill.append(
            {
                "skill": name,
                "score": round(coverage, 1),
                "similarity": round(coverage / 100, 3),
                "matched_with": matched or None,
                "proficiency": None,
                "must_have": must,
                "weight": weight,
                "reason": (judged.reason if judged else "") or "",
            }
        )
        weighted_sum += coverage * weight
        weight_total += weight

    overall = (weighted_sum / weight_total) if weight_total else 0.0
    if unmet:
        overall = min(overall, UNMET_MUST_HAVE_CEILING)

    return {
        "overall": round(overall, 1),
        "per_skill": per_skill,
        "unmet_must_haves": unmet,
        "summary": result.summary,
        "method": "llm" if used_llm else "ontology-fallback",
        "used_llm": used_llm,
        "provider": meta["provider"] if used_llm else "deterministic",
        "fallback_used": bool(meta.get("fallback_used")),
        "warning": meta.get("warning"),
    }


def match_skills(required: list[dict[str, Any]], offered: list[dict[str, Any]]) -> dict[str, Any]:
    provider = get_embedding_provider()

    if not required:
        return {"overall": 100.0, "per_skill": [], "method": "no-requirements", "embedding_provider": provider.name}

    offered_norm: list[dict[str, Any]] = []
    for o in offered or []:
        name = canonicalize(o.get("name") if isinstance(o, dict) else o)
        if not name:
            continue
        offered_norm.append(
            {
                "name": name,
                "proficiency": int((o.get("proficiency") if isinstance(o, dict) else 3) or 3),
                "years": float((o.get("years") if isinstance(o, dict) else 0) or 0),
            }
        )

    per_skill: list[dict[str, Any]] = []
    weighted_sum = 0.0
    weight_total = 0.0
    unmet_must_haves: list[str] = []

    for req in required:
        raw = req.get("name") if isinstance(req, dict) else req
        name = canonicalize(raw)
        if not name:
            continue
        weight = float(req.get("weight", 0.8)) if isinstance(req, dict) else 0.8
        must = bool(req.get("mustHave", req.get("must_have", True))) if isinstance(req, dict) else True
        if must:
            weight = max(weight, 0.9)

        best_sim = 0.0
        best_match: dict[str, Any] | None = None
        for cand in offered_norm:
            sim = semantic_skill_similarity(name, cand["name"])
            if sim > best_sim:
                best_sim = sim
                best_match = cand

        # Proficiency scales an existing match; it can never create one.
        prof = best_match["proficiency"] if best_match and best_sim > 0 else 0
        prof_factor = (0.7 + 0.075 * max(prof - 1, 0)) if prof else 0.0
        score = best_sim * prof_factor

        if must and score < 0.35:
            unmet_must_haves.append(name)

        per_skill.append(
            {
                "skill": name,
                "score": round(score * 100, 1),
                "similarity": round(best_sim, 3),
                "matched_with": best_match["name"] if best_match and best_sim > 0 else None,
                "proficiency": prof or None,
                "must_have": must,
                "weight": weight,
            }
        )
        weighted_sum += score * weight
        weight_total += weight

    overall = (weighted_sum / weight_total * 100) if weight_total else 0.0
    if unmet_must_haves:
        overall = min(overall, UNMET_MUST_HAVE_CEILING)

    return {
        "overall": round(overall, 1),
        "per_skill": per_skill,
        "unmet_must_haves": unmet_must_haves,
        "method": f"ontology+{provider.name}",
        "embedding_provider": provider.name,
        "embedding_is_neural": provider.is_neural,
    }
