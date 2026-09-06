/**
 * The scheduling engine.
 *
 * Pipeline:
 *   1. Resolve HARD feasibility deterministically in Node (availability
 *      intersection, working hours, buffers, per-day caps, round dependencies).
 *      Anything that survives this stage is *guaranteed* bookable.
 *   2. Hand the feasible (slot x interviewer) space to OR-Tools CP-SAT in the
 *      Python service, which picks the assignment maximising a weighted soft
 *      objective and returns ranked alternatives.
 *   3. If the AI service is unreachable, an equivalent JS scorer ranks the same
 *      feasible space. The result is identical in shape, marked JS_FALLBACK,
 *      and the platform keeps working.
 *
 * The optimizer can only ever choose among slots step 1 already proved legal, so
 * a solver bug (or an LLM anywhere upstream) can never produce a double booking.
 */
import prisma from '../lib/prisma.js';
import logger from '../lib/logger.js';
import { callAiService } from '../providers/aiClient.js';
import { rankInterviewers } from './matching.service.js';
import { candidateFreeWindows } from './availability.service.js';
import { getSettings } from './settings.service.js';
import { parseArray, stringifyJson } from '../lib/json.js';
import {
  enumerateSlots,
  intersectWindows,
  mergeWindows,
  localMinuteOfDay,
  timezoneSpreadHours,
  addMinutes,
  humanSlot,
  DateTime,
} from '../lib/time.js';
import { noFeasibleSchedule, notFound } from '../lib/errors.js';
import { notify } from './notification.service.js';
import { SETTING_KEYS, REQUEST_STATUS, ACTIVE_INTERVIEW_STATUSES, NOTIFICATION_TYPES } from '../../../shared/constants.js';

/** Soft-objective weights. Mirrored in ai-service/app/services/optimizer.py. */
export const SLOT_WEIGHTS = Object.freeze({
  panelSkill: 0.3,
  candidatePreference: 0.2,
  bufferQuality: 0.15,
  workloadBalance: 0.15,
  timezoneComfort: 0.1,
  earliness: 0.1,
});

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/**
 * Build the feasible space: every start instant where the candidate is free AND
 * at least `panelSize` eligible interviewers are simultaneously free.
 */
export async function buildFeasibleSpace(request, { excludeInterviewId = null, maxSlots = 240 } = {}) {
  const settings = await getSettings();
  const candidate = request.application.candidate;
  const candidateZone = candidate.user?.timezone || 'UTC';

  const now = new Date();
  const rangeStart = new Date(Math.max(+new Date(request.earliestUtc), +now));
  const rangeEnd = new Date(request.latestUtc);

  const diagnostics = { checks: [] };

  if (rangeEnd <= rangeStart) {
    diagnostics.checks.push({ check: 'date_range', ok: false, detail: 'The requested date range has already passed.' });
    return { slots: [], interviewers: [], diagnostics, rangeStart, rangeEnd, candidateZone };
  }

  // --- Round dependency: a later round cannot start before the earlier one ends.
  let dependencyEnd = null;
  if (request.dependsOnRequestId) {
    const prior = await prisma.interview.findFirst({
      where: { requestId: request.dependsOnRequestId, status: { in: [...ACTIVE_INTERVIEW_STATUSES, 'COMPLETED'] } },
      orderBy: { endUtc: 'desc' },
    });
    if (prior) {
      dependencyEnd = addMinutes(prior.endUtc, request.bufferMinutes);
      diagnostics.checks.push({
        check: 'round_dependency',
        ok: true,
        detail: `Must start after round ${request.roundNumber - 1} ends (${prior.endUtc.toISOString()})`,
      });
    }
  }
  const effectiveStart = dependencyEnd && dependencyEnd > rangeStart ? dependencyEnd : rangeStart;

  // --- Candidate side.
  const candidateAvail = await candidateFreeWindows(candidate, effectiveStart, rangeEnd, request.bufferMinutes, excludeInterviewId);
  diagnostics.checks.push({
    check: 'candidate_availability',
    ok: candidateAvail.free.length > 0,
    detail: candidateAvail.free.length
      ? `${Math.round(candidateAvail.free.reduce((s, w) => s + (w.end - w.start) / 60000, 0) / 60)}h free`
      : 'Candidate has no free time in this range',
    declared: candidateAvail.hasDeclaredAvailability,
  });
  if (!candidateAvail.free.length) {
    return { slots: [], interviewers: [], diagnostics, rangeStart: effectiveStart, rangeEnd, candidateZone, candidateAvail };
  }

  // --- Interviewer side (hard-filtered + ranked).
  const matching = await rankInterviewers({
    request,
    rangeStart: effectiveStart,
    rangeEnd,
    excludeInterviewId,
    limit: 15,
  });
  diagnostics.checks.push({
    check: 'eligible_interviewers',
    ok: matching.ranked.length >= request.requiredInterviewerCount,
    detail: `${matching.ranked.length} eligible of ${matching.consideredCount} (need ${request.requiredInterviewerCount})`,
    rejected: matching.rejected.slice(0, 8),
  });
  if (matching.ranked.length < request.requiredInterviewerCount) {
    return { slots: [], interviewers: matching.ranked, matching, diagnostics, rangeStart: effectiveStart, rangeEnd, candidateZone, candidateAvail };
  }

  // --- Slot enumeration on the candidate's clock (so times look round to them).
  const granularity = settings[SETTING_KEYS.SLOT_GRANULARITY_MINUTES] || 15;
  const candidateSlots = enumerateSlots({
    windows: candidateAvail.free,
    durationMinutes: request.durationMinutes,
    granularityMinutes: granularity,
    zone: candidateZone,
    limit: 800,
  });

  // Pre-compute daily counts so we can enforce max-interviews-per-day cheaply.
  const dailyCounts = await interviewerDailyCounts(matching.ranked.map((i) => i.interviewerId), effectiveStart, rangeEnd);
  const candidateDailyCounts = await candidateDailyLoad(candidate.id, effectiveStart, rangeEnd);

  const slots = [];
  for (const slot of candidateSlots) {
    const eligible = [];
    for (const iv of matching.ranked) {
      const fits = iv.freeWindows.some((w) => +w.start <= +slot.start && +w.end >= +slot.end);
      if (!fits) continue;

      // Per-day interview ceiling for the interviewer, in their own timezone.
      const dayKey = DateTime.fromJSDate(slot.start, { zone: iv.timezone }).toISODate();
      const already = dailyCounts.get(`${iv.interviewerId}:${dayKey}`) || 0;
      if (already >= iv.maxInterviewsPerDay) continue;

      eligible.push(iv);
    }
    if (eligible.length < request.requiredInterviewerCount) continue;

    // Candidate's own per-day ceiling.
    const candDayKey = DateTime.fromJSDate(slot.start, { zone: candidateZone }).toISODate();
    if ((candidateDailyCounts.get(candDayKey) || 0) >= (candidate.maxInterviewsPerDay || 2)) continue;

    slots.push({ start: slot.start, end: slot.end, eligible: eligible.map((e) => e.interviewerId) });
    if (slots.length >= maxSlots) break;
  }

  diagnostics.checks.push({
    check: 'feasible_slots',
    ok: slots.length > 0,
    detail: `${slots.length} slots satisfy every hard constraint`,
  });

  return {
    slots,
    interviewers: matching.ranked,
    matching,
    diagnostics,
    rangeStart: effectiveStart,
    rangeEnd,
    candidateZone,
    candidateAvail,
    granularity,
  };
}

async function interviewerDailyCounts(interviewerIds, from, to) {
  const map = new Map();
  if (!interviewerIds.length) return map;
  const seats = await prisma.interviewPanelMember.findMany({
    where: {
      interviewerId: { in: interviewerIds },
      responseStatus: { not: 'DECLINED' },
      interview: { status: { in: ACTIVE_INTERVIEW_STATUSES }, startUtc: { gte: from, lte: to } },
    },
    include: {
      interview: { select: { startUtc: true } },
      interviewer: { include: { user: { select: { timezone: true } } } },
    },
  });
  for (const seat of seats) {
    const zone = seat.interviewer.user.timezone || 'UTC';
    const day = DateTime.fromJSDate(seat.interview.startUtc, { zone }).toISODate();
    const key = `${seat.interviewerId}:${day}`;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

async function candidateDailyLoad(candidateId, from, to) {
  const map = new Map();
  const rows = await prisma.interview.findMany({
    where: {
      request: { application: { candidateId } },
      status: { in: ACTIVE_INTERVIEW_STATUSES },
      startUtc: { gte: from, lte: to },
    },
    include: { request: { include: { application: { include: { candidate: { include: { user: true } } } } } } },
  });
  for (const iv of rows) {
    const zone = iv.request.application.candidate.user.timezone || 'UTC';
    const day = DateTime.fromJSDate(iv.startUtc, { zone }).toISODate();
    map.set(day, (map.get(day) || 0) + 1);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Scoring (shared vocabulary with the CP-SAT objective)
// ---------------------------------------------------------------------------

/** Per-(slot, panel) soft score, 0..100, plus a human-readable breakdown. */
export function scoreAssignment({ slot, panel, request, candidate, candidateZone, preferredWindows, now = new Date() }) {
  const panelSkill = panel.reduce((s, p) => s + p.matchScore, 0) / Math.max(panel.length, 1);

  // Candidate preference: inside a declared PREFERRED window, or inside their
  // stated preferred hours.
  const inPreferred = preferredWindows.some((w) => +w.start <= +slot.start && +w.end >= +slot.end);
  const localStart = localMinuteOfDay(slot.start, candidateZone);
  const localEnd = localMinuteOfDay(slot.end, candidateZone);
  const prefStart = candidate.preferredStartMinute ?? 540;
  const prefEnd = candidate.preferredEndMinute ?? 1200;
  const insideStatedHours = localStart >= prefStart && localEnd <= prefEnd && localEnd > localStart;
  const candidatePreference = inPreferred ? 100 : insideStatedHours ? 78 : 40;

  // Buffer quality: how much slack exists around the slot for everyone.
  const bufferQuality = clamp(
    panel.reduce((min, p) => {
      const gap = nearestGapMinutes(p.freeWindows, slot);
      return Math.min(min, gap);
    }, Number.POSITIVE_INFINITY) === Number.POSITIVE_INFINITY
      ? 70
      : Math.min(
          100,
          (panel.reduce((min, p) => Math.min(min, nearestGapMinutes(p.freeWindows, slot)), Number.POSITIVE_INFINITY) /
            Math.max(request.bufferMinutes * 2, 30)) * 100
        )
  );

  const workloadBalance = clamp(
    100 - (panel.reduce((s, p) => s + (p.workload?.utilization ?? 0), 0) / Math.max(panel.length, 1)) * 100
  );

  // Timezone comfort: every participant's local clock inside civil hours.
  const zones = [candidateZone, ...panel.map((p) => p.timezone)];
  const worstLocalPenalty = Math.max(
    ...zones.map((z) => {
      const s = localMinuteOfDay(slot.start, z);
      const e = localMinuteOfDay(slot.end, z);
      if (e <= s) return 100; // crosses local midnight
      if (s >= 540 && e <= 1080) return 0; // 09:00-18:00
      if (s >= 480 && e <= 1200) return 25; // 08:00-20:00
      if (s >= 420 && e <= 1320) return 55;
      return 90;
    })
  );
  const timezoneComfort = clamp(100 - worstLocalPenalty);

  // Earliness: sooner reduces candidate waiting and drop-off.
  const daysOut = (+slot.start - +now) / (24 * 60 * 60 * 1000);
  const earliness = clamp(100 - daysOut * 7);

  const score =
    panelSkill * SLOT_WEIGHTS.panelSkill +
    candidatePreference * SLOT_WEIGHTS.candidatePreference +
    bufferQuality * SLOT_WEIGHTS.bufferQuality +
    workloadBalance * SLOT_WEIGHTS.workloadBalance +
    timezoneComfort * SLOT_WEIGHTS.timezoneComfort +
    earliness * SLOT_WEIGHTS.earliness;

  // Risk is deliberately a separate, explainable heuristic - NOT a prediction.
  const tzSpread = timezoneSpreadHours(zones, slot.start);
  const risk = clamp(
    (100 - bufferQuality) * 0.3 +
      (100 - workloadBalance) * 0.25 +
      Math.min(daysOut * 3, 30) * 0.2 +
      Math.min(tzSpread * 6, 40) * 0.15 +
      (panel.length - 1) * 8 * 0.1,
    0,
    100
  ) / 100;

  const breakdown = {
    panelSkill: Math.round(panelSkill),
    candidatePreference,
    bufferQuality: Math.round(bufferQuality),
    workloadBalance: Math.round(workloadBalance),
    timezoneComfort,
    earliness: Math.round(earliness),
    timezoneSpreadHours: Number(tzSpread.toFixed(1)),
    daysOut: Number(daysOut.toFixed(1)),
  };

  return { score: Math.round(score), risk: Number(risk.toFixed(3)), breakdown, inPreferred, insideStatedHours };
}

/** Minutes of free space around a slot inside the containing free window. */
function nearestGapMinutes(freeWindows, slot) {
  const containing = freeWindows.find((w) => +w.start <= +slot.start && +w.end >= +slot.end);
  if (!containing) return 0;
  const before = (+slot.start - +containing.start) / 60000;
  const after = (+containing.end - +slot.end) / 60000;
  return Math.min(before, after);
}

function buildSlotReasons({ scored, panel, request, candidateZone, slot }) {
  const reasons = [];
  const b = scored.breakdown;

  reasons.push(
    scored.inPreferred
      ? 'Falls inside the candidate\'s explicitly preferred window'
      : scored.insideStatedHours
        ? 'Within the candidate\'s stated preferred hours'
        : 'Outside the candidate\'s preferred hours (accepted because no better slot exists)'
  );
  reasons.push(`Panel skill match ${b.panelSkill}% (${panel.map((p) => p.name).join(', ')})`);
  reasons.push(
    b.bufferQuality >= 80
      ? `Comfortable buffer around the slot (>= ${request.bufferMinutes} min protected on both sides)`
      : `${request.bufferMinutes}-minute buffer maintained, but the surrounding gap is tight`
  );
  reasons.push(
    b.workloadBalance >= 70
      ? 'Selected interviewers have low current load'
      : 'Selected interviewers are moderately loaded this week'
  );
  reasons.push(
    b.timezoneSpreadHours === 0
      ? 'All participants share a timezone'
      : `${b.timezoneSpreadHours}h timezone spread; slot sits inside working hours for everyone`
  );
  reasons.push(`${b.daysOut} days out - ${b.daysOut <= 3 ? 'keeps candidate waiting time short' : 'later date, higher change risk'}`);
  reasons.push(`Local time for candidate: ${humanSlot(slot.start, slot.end, candidateZone)}`);
  return reasons;
}

// ---------------------------------------------------------------------------
// Proposal generation
// ---------------------------------------------------------------------------

/**
 * Generate ranked slot proposals for a request.
 * @returns {Promise<{proposals: object[], engineUsed: string, diagnostics: object, matching: object}>}
 */
export async function generateProposals(requestId, { excludeInterviewId = null, persist = true } = {}) {
  const request = await prisma.interviewRequest.findUnique({
    where: { id: requestId },
    include: {
      application: {
        include: {
          job: true,
          candidate: { include: { user: true, skills: { include: { skill: true } } } },
        },
      },
    },
  });
  if (!request) throw notFound('Interview request not found');

  const settings = await getSettings();
  const maxProposals = settings[SETTING_KEYS.MAX_PROPOSALS] || 5;

  const space = await buildFeasibleSpace(request, { excludeInterviewId });

  if (!space.slots.length) {
    if (persist) {
      await prisma.interviewRequest.update({
        where: { id: requestId },
        data: { status: REQUEST_STATUS.FAILED, failureReason: summariseFailure(space.diagnostics) },
      });
    }
    throw noFeasibleSchedule({
      diagnostics: space.diagnostics,
      suggestion: suggestFix(space.diagnostics),
      eligibleInterviewers: (space.interviewers || []).map((i) => ({ id: i.interviewerId, name: i.name, matchScore: i.matchScore })),
      rejected: space.matching?.rejected?.slice(0, 10) ?? [],
    });
  }

  const byId = new Map(space.interviewers.map((i) => [i.interviewerId, i]));

  // ---- Try the CP-SAT optimizer first.
  let ranked = null;
  let engineUsed = 'ORTOOLS';

  const solverPayload = {
    request: {
      id: request.id,
      duration_minutes: request.durationMinutes,
      panel_size: request.requiredInterviewerCount,
      buffer_minutes: request.bufferMinutes,
      candidate_timezone: space.candidateZone,
      candidate_preferred_start_minute: request.application.candidate.preferredStartMinute,
      candidate_preferred_end_minute: request.application.candidate.preferredEndMinute,
    },
    slots: space.slots.map((s, idx) => ({
      index: idx,
      start_utc: s.start.toISOString(),
      end_utc: s.end.toISOString(),
      eligible_interviewers: s.eligible,
      candidate_preferred: space.candidateAvail.preferred.some((w) => +w.start <= +s.start && +w.end >= +s.end),
      local_start_minute_candidate: localMinuteOfDay(s.start, space.candidateZone),
      days_out: (+s.start - Date.now()) / 86400000,
    })),
    interviewers: space.interviewers.map((i) => ({
      id: i.interviewerId,
      match_score: i.matchScore,
      utilization: i.workload?.utilization ?? 0,
      timezone: i.timezone,
      max_per_day: i.maxInterviewsPerDay,
    })),
    weights: SLOT_WEIGHTS,
    max_proposals: maxProposals,
  };

  const solverRes = await callAiService('/schedule/solve', solverPayload);

  if (solverRes.ok && Array.isArray(solverRes.data?.proposals) && solverRes.data.proposals.length) {
    ranked = solverRes.data.proposals
      .map((p) => {
        const slot = space.slots[p.slot_index];
        if (!slot) return null;
        const panel = p.interviewer_ids.map((id) => byId.get(id)).filter(Boolean);
        if (panel.length !== request.requiredInterviewerCount) return null;
        const scored = scoreAssignment({
          slot,
          panel,
          request,
          candidate: request.application.candidate,
          candidateZone: space.candidateZone,
          preferredWindows: space.candidateAvail.preferred,
        });
        return {
          slot,
          panel,
          // Trust our own transparent scorer for the displayed number, and keep
          // the solver's objective value alongside it for comparison.
          score: scored.score,
          risk: scored.risk,
          breakdown: { ...scored.breakdown, solverObjective: p.objective_value },
          reasons: buildSlotReasons({ scored, panel, request, candidateZone: space.candidateZone, slot }),
        };
      })
      .filter(Boolean);
    if (!ranked.length) ranked = null;
  }

  // ---- Deterministic JS fallback over the same feasible space.
  if (!ranked) {
    engineUsed = 'JS_FALLBACK';
    if (!solverRes.ok) {
      logger.warn('Optimizer unavailable - ranking with the JS fallback engine', { reason: solverRes.error });
    }
    ranked = rankWithJsEngine({ space, request, byId, maxProposals });
  }

  ranked.sort((a, b) => b.score - a.score);

  // Enforce variety: do not return five variants of the same hour.
  const diversified = diversify(ranked, maxProposals);

  const proposals = diversified.map((p, idx) => ({
    rank: idx + 1,
    startUtc: p.slot.start,
    endUtc: p.slot.end,
    score: p.score,
    riskScore: p.risk,
    interviewerIds: p.panel.map((x) => x.interviewerId),
    interviewers: p.panel.map((x) => ({
      id: x.interviewerId,
      name: x.name,
      title: x.title,
      timezone: x.timezone,
      matchScore: x.matchScore,
      workloadLevel: x.workload?.level,
      reasons: x.reasons,
    })),
    reasons: p.reasons,
    breakdown: p.breakdown,
    engineUsed,
    localLabels: {
      candidate: humanSlot(p.slot.start, p.slot.end, space.candidateZone),
      interviewers: p.panel.map((x) => ({ name: x.name, label: humanSlot(p.slot.start, p.slot.end, x.timezone) })),
    },
  }));

  // Persisting returns the row ids, which the client needs in order to confirm
  // for a specific proposal.
  if (persist) {
    const ids = await persistProposals(requestId, proposals, engineUsed, settings);
    proposals.forEach((p, i) => {
      p.id = ids[i];
    });

    await notify({
      userId: request.application.candidate.userId,
      type: NOTIFICATION_TYPES.SLOTS_PROPOSED,
      context: {
        jobTitle: request.application.job.title,
        roundName: request.roundName,
        slotCount: proposals.length,
        slotLabel: humanSlot(proposals[0].startUtc, proposals[0].endUtc, space.candidateZone),
      },
      channels: ['SMS'],
      relatedEntity: 'InterviewRequest',
      relatedId: requestId,
    });
  }

  return {
    proposals,
    engineUsed,
    diagnostics: space.diagnostics,
    matching: {
      aiProvider: space.matching?.aiProvider,
      fallbackUsed: space.matching?.fallbackUsed,
      weights: space.matching?.weights,
      eligible: space.interviewers.map((i) => ({
        id: i.interviewerId,
        name: i.name,
        title: i.title,
        matchScore: i.matchScore,
        breakdown: i.breakdown,
        workload: i.workload,
        reasons: i.reasons,
        perSkill: i.perSkill,
      })),
      rejected: space.matching?.rejected ?? [],
    },
    feasibleSlotCount: space.slots.length,
  };
}

/** Greedy + exhaustive-per-slot ranking used when CP-SAT is unavailable. */
function rankWithJsEngine({ space, request, byId, maxProposals }) {
  const out = [];
  for (const slot of space.slots) {
    const eligible = slot.eligible.map((id) => byId.get(id)).filter(Boolean);
    if (eligible.length < request.requiredInterviewerCount) continue;

    // Best panel for this slot = top-N by match score with a workload tiebreak.
    const panel = [...eligible]
      .sort((a, b) => b.matchScore - a.matchScore || (a.workload?.utilization ?? 0) - (b.workload?.utilization ?? 0))
      .slice(0, request.requiredInterviewerCount);

    const scored = scoreAssignment({
      slot,
      panel,
      request,
      candidate: request.application.candidate,
      candidateZone: space.candidateZone,
      preferredWindows: space.candidateAvail.preferred,
    });

    out.push({
      slot,
      panel,
      score: scored.score,
      risk: scored.risk,
      breakdown: scored.breakdown,
      reasons: buildSlotReasons({ scored, panel, request, candidateZone: space.candidateZone, slot }),
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, Math.max(maxProposals * 4, 20));
}

/** Keep at most 2 proposals per calendar day so the recruiter sees real choice. */
function diversify(ranked, limit) {
  const perDay = new Map();
  const picked = [];
  for (const p of ranked) {
    const day = p.slot.start.toISOString().slice(0, 10);
    const count = perDay.get(day) || 0;
    if (count >= 2) continue;
    perDay.set(day, count + 1);
    picked.push(p);
    if (picked.length >= limit) break;
  }
  // Top up if diversity left us short.
  if (picked.length < limit) {
    for (const p of ranked) {
      if (picked.includes(p)) continue;
      picked.push(p);
      if (picked.length >= limit) break;
    }
  }
  return picked;
}

async function persistProposals(requestId, proposals, engineUsed, settings) {
  const ttlHours = settings[SETTING_KEYS.PROPOSAL_TTL_HOURS] || 48;
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000);

  // createMany does not return rows on every engine, so we create individually
  // and collect the ids in order.
  return prisma.$transaction(async (tx) => {
    await tx.slotProposal.updateMany({
      where: { requestId, status: 'OPEN' },
      data: { status: 'EXPIRED' },
    });

    const ids = [];
    for (const p of proposals) {
      const row = await tx.slotProposal.create({
        data: {
          requestId,
          rank: p.rank,
          startUtc: p.startUtc,
          endUtc: p.endUtc,
          score: p.score,
          riskScore: p.riskScore,
          interviewerIdsCsv: p.interviewerIds.join(','),
          // Carried to confirm time so the booked panel seat keeps the score
          // the matcher actually computed instead of a placeholder.
          matchScoresJson: stringifyJson(
            Object.fromEntries((p.interviewers || []).map((i) => [i.id, i.matchScore ?? 0]))
          ),
          reasonsJson: stringifyJson(p.reasons),
          breakdownJson: stringifyJson(p.breakdown),
          engineUsed,
          expiresAt,
        },
        select: { id: true },
      });
      ids.push(row.id);
    }

    await tx.interviewRequest.update({
      where: { id: requestId },
      data: { status: REQUEST_STATUS.PROPOSED, failureReason: null },
    });
    return ids;
  });
}

function summariseFailure(diagnostics) {
  const failed = diagnostics.checks.find((c) => c.ok === false);
  return failed ? `${failed.check}: ${failed.detail}` : 'No feasible slot found';
}

/** Actionable next step for the recruiter instead of a dead end. */
function suggestFix(diagnostics) {
  const failed = diagnostics.checks.find((c) => c.ok === false);
  switch (failed?.check) {
    case 'date_range':
      return 'Extend the preferred date range - the current window is in the past.';
    case 'candidate_availability':
      return 'Ask the candidate to add availability, or widen the date range.';
    case 'eligible_interviewers':
      return 'Reduce the panel size, relax required skills, or add interviewers who cover this interview type.';
    case 'feasible_slots':
      return 'Availability exists on both sides but never overlaps. Widen the date range, shorten the interview, or reduce the buffer.';
    default:
      return 'Widen the date range or relax one of the constraints.';
  }
}

export { suggestFix, summariseFailure };
