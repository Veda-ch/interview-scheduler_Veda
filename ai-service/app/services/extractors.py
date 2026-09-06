"""Deterministic extractors.

These are the DEMO-MODE brain and the safety net behind every LLM call. They use
a curated skill ontology plus pattern matching - no model, no network. We are
explicit about that: results produced here are reported with
`provider: "deterministic"` so nothing in the UI claims a model was involved.
"""
from __future__ import annotations

import re
from typing import Any

from ..schemas import (
    AvailabilityConstraints,
    FeedbackAnalysis,
    GeneratedMessage,
    JdAnalysis,
    ResumeAnalysis,
    ResumeSkill,
    WeightedSkill,
)

# --------------------------------------------------------------------------- #
# Skill ontology: canonical name -> surface forms + related concepts.
# Related terms drive the "semantic" part of matching without needing a model.
# --------------------------------------------------------------------------- #

SKILL_ONTOLOGY: dict[str, dict[str, Any]] = {
    "Java": {"aliases": ["java", "core java", "java 8", "java11", "j2ee"], "related": ["Spring Boot", "Hibernate", "JPA", "JVM"], "category": "TECHNICAL"},
    "Spring Boot": {"aliases": ["spring boot", "springboot", "spring-boot"], "related": ["Java", "Spring", "REST APIs", "Microservices"], "category": "TECHNICAL"},
    "Spring": {"aliases": ["spring framework", "spring mvc"], "related": ["Java", "Spring Boot"], "category": "TECHNICAL"},
    "Hibernate": {"aliases": ["hibernate", "orm"], "related": ["Java", "JPA", "SQL"], "category": "TECHNICAL"},
    "JPA": {"aliases": ["jpa"], "related": ["Hibernate", "Java", "SQL"], "category": "TECHNICAL"},
    "SQL": {"aliases": ["sql", "queries", "rdbms"], "related": ["PostgreSQL", "MySQL", "SQL Optimization", "Database Indexing"], "category": "TECHNICAL"},
    "SQL Optimization": {"aliases": ["sql optimization", "sql optimisation", "query optimization", "query tuning"], "related": ["SQL", "Database Indexing", "Database Optimization"], "category": "TECHNICAL"},
    "Database Indexing": {"aliases": ["indexing", "database indexing", "index design"], "related": ["SQL", "SQL Optimization"], "category": "TECHNICAL"},
    "Database Optimization": {"aliases": ["database optimization", "db optimization", "database tuning"], "related": ["SQL", "SQL Optimization", "Database Indexing"], "category": "TECHNICAL"},
    "PostgreSQL": {"aliases": ["postgresql", "postgres", "psql"], "related": ["SQL", "Database Indexing"], "category": "TECHNICAL"},
    "MySQL": {"aliases": ["mysql"], "related": ["SQL"], "category": "TECHNICAL"},
    "MongoDB": {"aliases": ["mongodb", "mongo", "nosql"], "related": ["NoSQL"], "category": "TECHNICAL"},
    "Redis": {"aliases": ["redis", "caching"], "related": ["System Design"], "category": "TECHNICAL"},
    "Kafka": {"aliases": ["kafka", "event streaming"], "related": ["Microservices", "System Design"], "category": "TECHNICAL"},
    "REST APIs": {"aliases": ["rest", "rest api", "rest apis", "restful", "web services"], "related": ["Spring Boot", "Microservices", "GraphQL"], "category": "TECHNICAL"},
    "GraphQL": {"aliases": ["graphql"], "related": ["REST APIs"], "category": "TECHNICAL"},
    "Microservices": {"aliases": ["microservices", "microservice architecture"], "related": ["System Design", "Docker", "Kubernetes", "REST APIs"], "category": "TECHNICAL"},
    "System Design": {"aliases": ["system design", "architecture", "scalability", "distributed systems"], "related": ["Microservices", "Kafka", "Redis"], "category": "TECHNICAL"},
    "Docker": {"aliases": ["docker", "containers"], "related": ["Kubernetes", "CI/CD"], "category": "TOOL"},
    "Kubernetes": {"aliases": ["kubernetes", "k8s"], "related": ["Docker", "AWS"], "category": "TOOL"},
    "AWS": {"aliases": ["aws", "amazon web services", "ec2", "s3", "lambda"], "related": ["Cloud", "Terraform"], "category": "TECHNICAL"},
    "GCP": {"aliases": ["gcp", "google cloud"], "related": ["Cloud"], "category": "TECHNICAL"},
    "Azure": {"aliases": ["azure"], "related": ["Cloud"], "category": "TECHNICAL"},
    "Terraform": {"aliases": ["terraform", "infrastructure as code"], "related": ["AWS", "CI/CD"], "category": "TOOL"},
    "CI/CD": {"aliases": ["ci/cd", "cicd", "jenkins", "github actions", "continuous integration"], "related": ["Docker", "Git"], "category": "TOOL"},
    "Python": {"aliases": ["python", "python3"], "related": ["Machine Learning", "Algorithms"], "category": "TECHNICAL"},
    "JavaScript": {"aliases": ["javascript", "js", "es6"], "related": ["TypeScript", "React", "Node.js"], "category": "TECHNICAL"},
    "TypeScript": {"aliases": ["typescript", "ts"], "related": ["JavaScript", "React"], "category": "TECHNICAL"},
    "React": {"aliases": ["react", "react.js", "reactjs"], "related": ["JavaScript", "TypeScript"], "category": "TECHNICAL"},
    "Node.js": {"aliases": ["node.js", "nodejs", "node", "express"], "related": ["JavaScript", "REST APIs"], "category": "TECHNICAL"},
    "Go": {"aliases": ["golang", "go lang"], "related": ["Microservices"], "category": "TECHNICAL"},
    "Data Structures": {"aliases": ["data structures", "ds"], "related": ["Algorithms", "Problem Solving"], "category": "TECHNICAL"},
    "Algorithms": {"aliases": ["algorithms", "dsa", "problem solving"], "related": ["Data Structures"], "category": "TECHNICAL"},
    "Machine Learning": {"aliases": ["machine learning", "ml", "deep learning"], "related": ["Python"], "category": "TECHNICAL"},
    "Linux": {"aliases": ["linux", "unix", "bash"], "related": ["Docker"], "category": "TOOL"},
    "Git": {"aliases": ["git", "version control"], "related": ["CI/CD"], "category": "TOOL"},
    "Unit Testing": {"aliases": ["unit testing", "junit", "pytest", "tdd"], "related": ["CI/CD"], "category": "TECHNICAL"},
    "Communication": {"aliases": ["communication", "articulate", "stakeholder"], "related": ["Leadership"], "category": "SOFT"},
    "Leadership": {"aliases": ["leadership", "team lead", "leading"], "related": ["Mentoring", "Communication"], "category": "SOFT"},
    "Mentoring": {"aliases": ["mentoring", "coaching", "mentorship"], "related": ["Leadership"], "category": "SOFT"},
    "Ownership": {"aliases": ["ownership", "self-driven", "accountability"], "related": ["Leadership"], "category": "SOFT"},
}

# Longest aliases first so "sql optimization" wins over bare "sql".
_ALIAS_INDEX: list[tuple[str, str]] = sorted(
    ((alias, canonical) for canonical, meta in SKILL_ONTOLOGY.items() for alias in meta["aliases"]),
    key=lambda pair: len(pair[0]),
    reverse=True,
)


def canonicalize(term: str) -> str:
    """Map any surface form onto its canonical skill name (or title-case it)."""
    key = re.sub(r"\s+", " ", str(term or "").strip().lower())
    if not key:
        return ""
    for alias, canonical in _ALIAS_INDEX:
        if key == alias:
            return canonical
    for alias, canonical in _ALIAS_INDEX:
        if re.search(rf"(^|\W){re.escape(alias)}(\W|$)", key):
            return canonical
    return " ".join(w.capitalize() if len(w) > 2 else w.upper() for w in key.split())


def find_skills(text: str) -> list[str]:
    """Ontology-driven skill spotting with word boundaries and longest-match wins."""
    hay = f" {re.sub(r'[^a-z0-9+#./ -]', ' ', str(text or '').lower())} "
    found: list[str] = []
    consumed: list[tuple[int, int]] = []

    for alias, canonical in _ALIAS_INDEX:
        for m in re.finditer(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])", hay):
            span = (m.start(), m.end())
            if any(s <= span[0] and span[1] <= e for s, e in consumed):
                continue
            consumed.append(span)
            if canonical not in found:
                found.append(canonical)
    return found


def related_terms(skill: str) -> set[str]:
    meta = SKILL_ONTOLOGY.get(skill)
    return set(meta["related"]) if meta else set()


def category_of(skill: str) -> str:
    meta = SKILL_ONTOLOGY.get(skill)
    return meta["category"] if meta else "TECHNICAL"


# --------------------------------------------------------------------------- #
# Extractors
# --------------------------------------------------------------------------- #


def extract_jd(text: str) -> JdAnalysis:
    skills = find_skills(text)
    lower = str(text or "").lower()

    rng = re.search(r"(\d+)\s*(?:-|to|–|—)\s*(\d+)\s*\+?\s*years?", lower)
    single = re.search(r"(\d+)\s*\+\s*years?", lower) or re.search(r"(\d+)\s*years?", lower)
    exp_min = float(rng.group(1)) if rng else (float(single.group(1)) if single else 0.0)
    exp_max = float(rng.group(2)) if rng else (exp_min + 3 if single else 10.0)

    if re.search(r"system design|architect|scalab|distributed", lower):
        itype = "SYSTEM_DESIGN"
    elif re.search(r"\bcoding\b|algorithm|data structure|leetcode", lower):
        itype = "CODING"
    elif re.search(r"hiring manager|people manag|stakeholder|team lead", lower):
        itype = "MANAGERIAL"
    elif re.search(r"culture fit|hr round|compensation", lower):
        itype = "HR"
    else:
        itype = "TECHNICAL"

    if re.search(r"principal|distinguished", lower):
        seniority = "PRINCIPAL"
    elif re.search(r"\bstaff\b", lower):
        seniority = "STAFF"
    elif re.search(r"senior|sr\.|lead", lower) or exp_min >= 5:
        seniority = "SENIOR"
    elif exp_min <= 1:
        seniority = "JUNIOR"
    else:
        seniority = "MID"

    # "must have" vs "nice to have" sections shift the weighting.
    # The must-have section is truncated at the first nice-to-have marker,
    # otherwise a single paragraph containing both would mark everything required.
    NICE_MARKER = r"nice[- ]to[- ]have|preferred|bonus|good to have|\bplus\b"
    must_section = ""
    nice_section = ""

    must_match = re.search(r"(must[- ]have|required|requirements)(.{0,800})", lower, re.DOTALL)
    if must_match:
        must_section = must_match.group(2)
        cut = re.search(NICE_MARKER, must_section)
        if cut:
            must_section = must_section[: cut.start()]

    nice_match = re.search(rf"({NICE_MARKER})(.{{0,500}})", lower, re.DOTALL)
    if nice_match:
        nice_section = nice_match.group(2)
        # Symmetrically, stop the nice-to-have section at a following must marker.
        cut = re.search(r"must[- ]have|required|requirements", nice_section)
        if cut:
            nice_section = nice_section[: cut.start()]

    def weight_for(skill: str) -> tuple[float, bool]:
        aliases = SKILL_ONTOLOGY.get(skill, {}).get("aliases", [skill.lower()])
        in_nice = any(a in nice_section for a in aliases)
        in_must = any(a in must_section for a in aliases)
        if in_nice and not in_must:
            return 0.4, False
        if in_must:
            return 1.0, True
        return 0.8, True

    technical, soft = [], []
    for skill in skills:
        weight, must = weight_for(skill)
        entry = WeightedSkill(name=skill, weight=weight, must_have=must)
        (soft if category_of(skill) == "SOFT" else technical).append(entry)

    topics: list[str] = []
    for s in technical[:6]:
        topics.append(s.name)
        for rel in list(related_terms(s.name))[:1]:
            if rel not in topics:
                topics.append(rel)

    return JdAnalysis(
        technical_skills=technical,
        soft_skills=soft,
        experience_min=exp_min,
        experience_max=max(exp_max, exp_min),
        interview_type=itype,
        topics=topics[:12],
        seniority=seniority,
        summary=f"Deterministic extraction: {len(technical)} technical and {len(soft)} soft skills identified.",
    )


def extract_resume(text: str, jd_skills: list[dict[str, Any]] | None = None) -> ResumeAnalysis:
    skills = find_skills(text)
    lower = str(text or "").lower()

    years = 0.0
    m = re.search(r"(\d+(?:\.\d+)?)\s*\+?\s*years?(?:\s+of)?(?:\s+experience)?", lower)
    if m:
        years = float(m.group(1))

    # Proficiency heuristic: repetition + explicit "expert/advanced" wording.
    resume_skills: list[ResumeSkill] = []
    for skill in skills:
        aliases = SKILL_ONTOLOGY.get(skill, {}).get("aliases", [skill.lower()])
        mentions = sum(len(re.findall(rf"(?<![a-z0-9]){re.escape(a)}(?![a-z0-9])", lower)) for a in aliases)
        proficiency = 3
        if mentions >= 3:
            proficiency = 4
        if re.search(rf"(expert|advanced|extensive)[^.]{{0,40}}{re.escape(aliases[0])}", lower):
            proficiency = 5
        if re.search(rf"(basic|familiar|exposure|beginner)[^.]{{0,40}}{re.escape(aliases[0])}", lower):
            proficiency = 2
        resume_skills.append(
            ResumeSkill(name=skill, proficiency=proficiency, evidence=f"{mentions} mention(s) in resume")
        )

    highlights = [
        line.strip("-• \t")
        for line in str(text or "").splitlines()
        if 30 < len(line.strip()) < 160 and re.search(r"\b(led|built|designed|improved|reduced|migrated|scaled)\b", line, re.I)
    ][:5]

    analysis = ResumeAnalysis(
        skills=resume_skills,
        years_experience=years,
        highlights=highlights,
        summary=f"Deterministic extraction: {len(resume_skills)} skills, ~{years:g} years experience.",
    )

    if jd_skills:
        analysis.jd_match = score_skill_match(jd_skills, [s.model_dump() for s in resume_skills])
    return analysis


DAY_WORDS = {
    "monday": "monday", "mon": "monday", "tuesday": "tuesday", "tue": "tuesday", "tues": "tuesday",
    "wednesday": "wednesday", "wed": "wednesday", "weds": "wednesday", "thursday": "thursday",
    "thu": "thursday", "thur": "thursday", "thurs": "thursday", "friday": "friday", "fri": "friday",
    "saturday": "saturday", "sat": "saturday", "sunday": "sunday", "sun": "sunday",
}
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"]


def _to_24h(hour: str, minute: str | None, meridiem: str | None) -> str:
    h = int(hour)
    mm = int(minute) if minute else 0
    if meridiem == "pm" and h < 12:
        h += 12
    elif meridiem == "am" and h == 12:
        h = 0
    elif meridiem is None and h <= 8:
        # "after 5" in a scheduling context means 17:00, not 05:00.
        h += 12
    return f"{min(h, 23):02d}:{mm:02d}"


def extract_availability(text: str) -> AvailabilityConstraints:
    lower = str(text or "").lower()

    avoid: set[str] = set()
    for seg in re.finditer(r"(?:except|not on|no|can'?t do|cannot do|unavailable on|avoid|apart from)\s+([a-z, and]+)", lower):
        for word, day in DAY_WORDS.items():
            if re.search(rf"\b{word}\b", seg.group(1)):
                avoid.add(day)

    days: set[str] = set()
    if re.search(r"weekday|working day|business day|mon(day)?\s*(?:-|to|–)\s*fri(day)?", lower):
        days.update(WEEKDAYS)
    if re.search(r"weekend", lower) and not re.search(r"no weekend|not weekend|except weekend", lower):
        days.update(["saturday", "sunday"])
    for word, day in DAY_WORDS.items():
        if re.search(rf"\b{word}\b", lower) and day not in avoid:
            days.add(day)

    if not days:
        days.update(WEEKDAYS)
    days -= avoid

    after = re.search(r"after\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", lower)
    before = re.search(r"before\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", lower)
    between = re.search(r"between\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:and|-|to|–)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", lower)

    start_time, end_time = "09:00", "18:00"
    if between:
        start_time = _to_24h(between.group(1), between.group(2), between.group(3))
        end_time = _to_24h(between.group(4), between.group(5), between.group(6))
    else:
        if after:
            start_time = _to_24h(after.group(1), after.group(2), after.group(3))
            end_time = "21:00"
        if before:
            end_time = _to_24h(before.group(1), before.group(2), before.group(3))
    if re.search(r"\bmornings?\b", lower) and not (after or before or between):
        start_time, end_time = "09:00", "12:00"
    if re.search(r"\bafternoons?\b", lower) and not (after or before or between):
        start_time, end_time = "13:00", "17:00"
    if re.search(r"\bevenings?\b", lower) and not (after or before or between):
        start_time, end_time = "17:00", "21:00"

    max_per_day = None
    if re.search(r"(?:not|no|don'?t want|avoid)[^.]{0,30}(?:two|2)\s+interviews?[^.]{0,20}(?:same day|one day|a day)", lower):
        max_per_day = 1
    elif re.search(r"(?:only|at most|max(?:imum)?)\s+(?:one|1)\s+interview", lower):
        max_per_day = 1
    else:
        mm = re.search(r"(?:at most|max(?:imum)?|no more than)\s+(\d)\s+interviews?", lower)
        if mm:
            max_per_day = max(1, min(int(mm.group(1)), 6))

    dates = re.findall(r"\b(\d{4}-\d{2}-\d{2})\b", lower)

    return AvailabilityConstraints(
        days=sorted(days, key=lambda d: WEEKDAYS.index(d) if d in WEEKDAYS else 9),
        avoid_days=sorted(avoid),
        start_time=start_time,
        end_time=end_time if end_time > start_time else "21:00",
        unavailable_dates=dates[:60],
        max_interviews_per_day=max_per_day,
        notes="Parsed by the deterministic rule-based parser.",
    )


POSITIVE = re.compile(r"strong|excellent|great|solid|good|deep|impressive|clear|confident|thorough", re.I)
NEGATIVE = re.compile(r"weak|poor|lacking|struggled|limited|needs? work|needs? improvement|gap|shallow|unclear|unable|difficulty|slow", re.I)


def extract_feedback(payload: dict[str, Any]) -> FeedbackAnalysis:
    text = str(payload.get("comments") or "")
    ratings: dict[str, float] = payload.get("ratings") or {}
    overall = int(payload.get("overall_rating") or 3)

    strengths: list[str] = []
    gaps: list[str] = []

    # Sentence + contrast-clause segmentation: "strong X but weak Y" must split.
    segments = re.split(r"(?<=[.!;])\s+|\s+\b(?:but|however|although|though|whereas|while)\b\s+", text, flags=re.I)
    for seg in segments:
        if not seg or not seg.strip():
            continue
        seg_skills = find_skills(seg)
        if not seg_skills:
            continue
        if NEGATIVE.search(seg):
            gaps.extend(seg_skills)
        elif POSITIVE.search(seg):
            strengths.extend(seg_skills)

    # Low structured ratings are gaps regardless of the prose.
    low_rated = [k for k, v in ratings.items() if float(v) <= 2]
    high_rated = [k for k, v in ratings.items() if float(v) >= 4]

    unclassified = [s for s in find_skills(text) if s not in strengths and s not in gaps]
    if not strengths:
        strengths = unclassified[:2]

    gap_list = list(dict.fromkeys([*gaps, *low_rated]))
    strength_list = list(dict.fromkeys([*strengths, *high_rated]))

    # Next-round focus = the gaps plus their ontology neighbours, so a "SQL
    # optimization" gap also pulls in "Database Indexing".
    focus: list[str] = []
    for g in gaps:
        focus.append(g)
        for rel in related_terms(g):
            if rel not in focus:
                focus.append(rel)

    sentiment = "POSITIVE" if overall >= 4 else "NEGATIVE" if overall <= 2 else "MIXED"

    return FeedbackAnalysis(
        strengths=strength_list[:10],
        skill_gaps=gap_list[:10],
        recommended_topics=focus[:8] or gap_list[:4],
        sentiment=sentiment,
        next_round_focus=focus[:6],
        summary=(
            f"Deterministic analysis: {len(strength_list)} strength(s), {len(gap_list)} gap(s); "
            f"overall rating {overall}/5."
        ),
    )


TEMPLATES: dict[str, tuple[str, str]] = {
    "INTERVIEW_SCHEDULED": (
        "Your {job_title} interview is confirmed for {slot_label}",
        "Hi {recipient_name},\n\nYour {round_name} interview for the {job_title} role is scheduled for "
        "{slot_label} ({timezone}).\n\nInterviewer(s): {interviewers}\nJoin link: {join_url}\n\n"
        "Please join a couple of minutes early. If the time no longer works, request a reschedule from "
        "your dashboard and we will find another slot.\n\nGood luck!\nTalent Team",
    ),
    "INTERVIEW_RESCHEDULED": (
        "Updated time for your {job_title} interview: {slot_label}",
        "Hi {recipient_name},\n\nYour {round_name} interview for {job_title} has moved to {slot_label} "
        "({timezone}).\n\nReason: {reason}\nJoin link: {join_url}\n\nApologies for the change - the "
        "updated calendar invitation is on its way.\n\nTalent Team",
    ),
    "INTERVIEW_CANCELLED": (
        "Your {job_title} interview on {slot_label} has been cancelled",
        "Hi {recipient_name},\n\nThe {round_name} interview for {job_title} scheduled for {slot_label} "
        "has been cancelled.\n\nReason: {reason}\n\nWe will follow up shortly with next steps.\n\nTalent Team",
    ),
    "INTERVIEWER_ASSIGNED": (
        "You are on a {job_title} panel - {slot_label}",
        "Hi {recipient_name},\n\nYou have been assigned to the {round_name} interview for {job_title} at "
        "{slot_label} ({timezone}).\n\nCandidate: {candidate_name}\nFocus areas: {focus_topics}\n"
        "Join link: {join_url}\n\nPlease accept or decline in the portal so we can plan the panel.\n\nTalent Team",
    ),
    "INTERVIEWER_REPLACED": (
        "Panel change for the {job_title} interview on {slot_label}",
        "Hi {recipient_name},\n\nThe panel for the {round_name} interview on {slot_label} has changed: "
        "{reason}\n\nEverything else stays the same, including the join link: {join_url}\n\nTalent Team",
    ),
    "INTERVIEW_REMINDER": (
        "Reminder: {job_title} interview at {slot_label}",
        "Hi {recipient_name},\n\nA quick reminder that your {round_name} interview starts at {slot_label} "
        "({timezone}).\n\nJoin link: {join_url}\n\nTalent Team",
    ),
    "SLOTS_PROPOSED": (
        "Choose your interview time for {job_title}",
        "Hi {recipient_name},\n\nWe have found times that work for you and the panel for the {round_name} "
        "interview.\n\nRecommended: {slot_label}\n\nOpen your dashboard to confirm this slot or pick an "
        "alternative.\n\nTalent Team",
    ),
    "INCIDENT_RAISED": (
        "Action needed: {job_title} interview on {slot_label}",
        "Hi {recipient_name},\n\nWe detected an issue with the {round_name} interview scheduled for "
        "{slot_label}: {reason}\n\nThe Control Tower is preparing recovery options.\n\nTalent Team",
    ),
    "RECOVERY_APPLIED": (
        "Resolved: {job_title} interview on {slot_label}",
        "Hi {recipient_name},\n\nThe issue with your {round_name} interview has been resolved "
        "automatically.\n\nWhat changed: {reason}\nCurrent time: {slot_label} ({timezone})\n"
        "Join link: {join_url}\n\nNo action is needed from you.\n\nTalent Team",
    ),
    "FEEDBACK_REQUESTED": (
        "Feedback needed: {candidate_name} ({job_title})",
        "Hi {recipient_name},\n\nPlease submit your feedback for the {round_name} interview with "
        "{candidate_name} held at {slot_label}.\n\nYour input decides what the next round focuses on.\n\nTalent Team",
    ),
}


class _SafeDict(dict):
    def __missing__(self, key: str) -> str:  # noqa: D105
        return "-"


def render_message(template_type: str, context: dict[str, Any]) -> GeneratedMessage:
    subject_tpl, body_tpl = TEMPLATES.get(template_type, TEMPLATES["INTERVIEW_SCHEDULED"])
    safe = _SafeDict({k: ("" if v is None else v) for k, v in (context or {}).items()})
    safe.setdefault("recipient_name", "there")
    return GeneratedMessage(
        subject=subject_tpl.format_map(safe),
        body=body_tpl.format_map(safe),
        tone="professional",
        generated_by="template",
    )


# --------------------------------------------------------------------------- #
# Skill matching (used when embeddings are unavailable)
# --------------------------------------------------------------------------- #


def score_skill_match(required: list[dict[str, Any]], offered: list[dict[str, Any]]) -> dict[str, Any]:
    """Ontology-aware overlap score.

    Exact canonical match = 1.0, ontology-related match = 0.55, otherwise 0.
    Weighted by the requirement's declared weight, and proficiency-adjusted.
    """
    if not required:
        return {"overall": 100.0, "per_skill": [], "method": "no-requirements"}

    offered_map: dict[str, int] = {}
    for o in offered:
        name = canonicalize(o.get("name") if isinstance(o, dict) else o)
        prof = int((o.get("proficiency") if isinstance(o, dict) else 3) or 3)
        offered_map[name] = max(offered_map.get(name, 0), prof)

    per_skill = []
    total_weight = 0.0
    weighted_score = 0.0

    for req in required:
        raw_name = req.get("name") if isinstance(req, dict) else req
        name = canonicalize(raw_name)
        weight = float(req.get("weight", 0.8)) if isinstance(req, dict) else 0.8
        must = bool(req.get("mustHave", req.get("must_have", True))) if isinstance(req, dict) else True
        weight = max(weight, 0.9) if must else weight

        if name in offered_map:
            base = 1.0
            matched_with = name
        else:
            neighbours = related_terms(name)
            hit = next((o for o in offered_map if o in neighbours), None)
            base = 0.55 if hit else 0.0
            matched_with = hit

        prof = offered_map.get(matched_with, 0) if matched_with else 0
        # Proficiency modulates a match between 0.7x and 1.0x - never invents one.
        prof_factor = 0.7 + 0.075 * max(prof - 1, 0) if prof else 0.0
        score = base * (prof_factor if prof else 0.0) if base else 0.0

        per_skill.append(
            {
                "skill": name,
                "score": round(score * 100, 1),
                "matched_with": matched_with,
                "must_have": must,
                "weight": weight,
                "proficiency": prof or None,
            }
        )
        total_weight += weight
        weighted_score += score * weight

    overall = (weighted_score / total_weight * 100) if total_weight else 0.0
    return {"overall": round(overall, 1), "per_skill": per_skill, "method": "ontology-overlap"}
