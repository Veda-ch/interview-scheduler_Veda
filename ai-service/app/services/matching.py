"""Semantic skill matching.

Combines three signals, in decreasing order of trust:
  1. canonical identity   (ontology says these are the same skill)     -> 1.00
  2. ontology adjacency   ("SQL Optimization" is adjacent to "SQL")    -> 0.60
  3. embedding similarity (lexical by default, neural if installed)    -> <= 0.50

Never an LLM: a hallucinated "yes, they match" would silently staff an
unqualified interviewer. This is a place for determinism.
"""
from __future__ import annotations

from typing import Any

from ..providers.embeddings import get_embedding_provider, semantic_skill_similarity
from .extractors import canonicalize


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

    return {
        "overall": round(overall, 1),
        "per_skill": per_skill,
        "unmet_must_haves": unmet_must_haves,
        "method": f"ontology+{provider.name}",
        "embedding_provider": provider.name,
        "embedding_is_neural": provider.is_neural,
    }
