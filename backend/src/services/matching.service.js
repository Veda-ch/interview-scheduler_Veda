/**
 * Interviewer matching.
 *
 * Two-stage by design:
 *
 *   1. HARD FILTER (deterministic, non-negotiable)
 *      active | conducts this interview type | not the candidate themselves |
 *      has some availability in range | under daily/weekly load ceiling
 *
 *   2. SOFT RANK (explainable weighted score)
 *      skill match (semantic, from the AI service; exact-overlap fallback)
 *      + seniority fit + workload headroom + timezone compatibility
 *      + availability abundance - repeat-interviewer penalty
 *
 * The AI only ever contributes the *skill similarity number*. It cannot admit an
 * interviewer who fails a hard filter, and every score component is reported so
 * the recruiter sees exactly why a person was ranked where they were.
 */
import prisma from '../lib/prisma.js';
import { parseArray, csvToArray } from '../lib/json.js';
import { computeWorkloadBulk } from './interviewer.service.js';
import { interviewerFreeWindows } from './availability.service.js';
import { semanticSkillMatch } from './ai.service.js';
import { windowMinutes, timezoneSpreadHours, isoWeekdayList } from '../lib/time.js';
import { ACTIVE_INTERVIEW_STATUSES } from '../../../shared/constants.js';

/** Weights sum to 1.0; exposed so the UI and docs can show the exact formula. */
export const MATCH_WEIGHTS = Object.freeze({
  skill: 0.45,
  workload: 0.2,
  availability: 0.15,
  experience: 0.1,
  timezone: 0.1,
});

const SENIORITY_RANK = { JUNIOR: 1, MID: 2, SENIOR: 3, STAFF: 4, PRINCIPAL: 5 };

/**
 * @param {object} p
 * @param {object} p.request InterviewRequest row (with application -> candidate)
 * @param {Date} p.rangeStart
 * @param {Date} p.rangeEnd
 * @param {string[]} [p.excludeInterviewerIds] e.g. the one who just cancelled
 * @param {string} [p.excludeInterviewId] ignore this interview's own bookings
 * @returns {Promise<{ranked: object[], rejected: object[], aiProvider: string, fallbackUsed: boolean}>}
 */
export async function rankInterviewers({
  request,
  rangeStart,
  rangeEnd,
  excludeInterviewerIds = [],
  excludeInterviewId = null,
  limit = 12,
}) {
  const candidate = request.application.candidate;
  const candidateZone = candidate.user?.timezone || 'UTC';
  const requiredSkills = parseArray(request.requiredSkillsJson);
  const focusTopics = parseArray(request.focusTopicsJson);

  // Focus topics from the previous round's feedback are treated as extra
  // must-cover skills - this is what makes the pipeline adaptive.
  const effectiveSkills = [
    ...requiredSkills,
    ...focusTopics.map((t) => ({ name: typeof t === 'string' ? t : t.name, weight: 0.9, mustHave: false, fromFeedback: true })),
  ].filter((s) => s?.name);

  const all = await prisma.interviewerProfile.findMany({
    where: { isActive: true },
    include: {
      user: { select: { id: true, name: true, email: true, timezone: true, isActive: true, avatarSeed: true } },
      skills: { include: { skill: true } },
    },
  });

  const excluded = new Set(excludeInterviewerIds);
  const rejected = [];
  const stage1 = [];

  for (const iv of all) {
    if (excluded.has(iv.id)) {
      rejected.push({ id: iv.id, name: iv.user.name, reason: 'Explicitly excluded (e.g. just became unavailable)' });
      continue;
    }
    if (!iv.user.isActive) {
      rejected.push({ id: iv.id, name: iv.user.name, reason: 'Account is deactivated' });
      continue;
    }
    if (iv.userId === candidate.userId) {
      rejected.push({ id: iv.id, name: iv.user.name, reason: 'Cannot interview themselves' });
      continue;
    }
    const types = csvToArray(iv.interviewTypesCsv);
    if (!types.includes(request.interviewType)) {
      rejected.push({
        id: iv.id,
        name: iv.user.name,
        reason: `Does not conduct ${request.interviewType} interviews (covers ${types.join(', ') || 'none'})`,
      });
      continue;
    }
    stage1.push(iv);
  }

  if (!stage1.length) {
    return { ranked: [], rejected, aiProvider: null, fallbackUsed: false, weights: MATCH_WEIGHTS };
  }

  // --- Availability + workload in bulk (one pass each, not N+1 per person).
  const workloads = await computeWorkloadBulk(stage1.map((i) => i.id));
  const freeByInterviewer = new Map();
  await Promise.all(
    stage1.map(async (iv) => {
      const res = await interviewerFreeWindows(iv, rangeStart, rangeEnd, request.bufferMinutes, excludeInterviewId);
      freeByInterviewer.set(iv.id, res);
    })
  );

  // --- Skill similarity from the AI service, one call for the whole cohort.
  const offeredByInterviewer = new Map(
    stage1.map((iv) => [iv.id, iv.skills.map((s) => ({ name: s.skill.name, proficiency: s.proficiency, years: s.yearsExperience }))])
  );

  let aiProvider = 'none';
  let fallbackUsed = false;
  const skillScores = new Map();

  if (effectiveSkills.length) {
    const results = await Promise.all(
      stage1.map(async (iv) => {
        const match = await semanticSkillMatch(effectiveSkills, offeredByInterviewer.get(iv.id) || []);
        return [iv.id, match];
      })
    );
    for (const [id, match] of results) {
      skillScores.set(id, match.data);
      aiProvider = match.provider;
      if (match.fallbackUsed) fallbackUsed = true;
    }
  }

  const rangeMinutes = Math.max((rangeEnd - rangeStart) / 60000, 1);
  const candidateHistory = await previousInterviewerIds(candidate.id);

  const scored = [];
  for (const iv of stage1) {
    const free = freeByInterviewer.get(iv.id);
    const freeMinutes = windowMinutes(free.free);

    if (freeMinutes < request.durationMinutes) {
      rejected.push({
        id: iv.id,
        name: iv.user.name,
        reason:
          free.declaredCount === 0
            ? 'No availability in the requested date range (working hours fully booked)'
            : 'Declared availability does not leave a long enough gap',
      });
      continue;
    }

    const load = workloads.get(iv.id);
    if (load.utilization >= 1) {
      rejected.push({
        id: iv.id,
        name: iv.user.name,
        reason: `At weekly capacity (${load.upcomingCount}/${load.maxPerWeek} interviews)`,
      });
      continue;
    }

    // ---- score components, each normalised 0..100
    const skill = skillScores.get(iv.id);
    const skillScore = effectiveSkills.length ? (skill?.overall ?? 0) : 70; // no skills asked -> neutral

    const workloadScore = Math.round(Math.max(0, 1 - load.utilization) * 100);

    const availabilityScore = Math.round(Math.min(freeMinutes / Math.min(rangeMinutes * 0.25, 600), 1) * 100);

    const seniorityGap = Math.abs(
      (SENIORITY_RANK[iv.seniority] || 2) - expectedSeniority(request.interviewType)
    );
    const experienceScore = Math.round(Math.max(0, 1 - seniorityGap * 0.22) * 100);

    const spread = timezoneSpreadHours([candidateZone, iv.user.timezone]);
    const timezoneScore = Math.round(Math.max(0, 1 - Math.min(Math.abs(spread), 12) / 12) * 100);

    let total =
      skillScore * MATCH_WEIGHTS.skill +
      workloadScore * MATCH_WEIGHTS.workload +
      availabilityScore * MATCH_WEIGHTS.availability +
      experienceScore * MATCH_WEIGHTS.experience +
      timezoneScore * MATCH_WEIGHTS.timezone;

    // Small penalty for interviewing the same candidate twice - panels should
    // add new signal per round, not repeat it.
    const repeat = candidateHistory.has(iv.id);
    if (repeat) total -= 6;

    const reasons = buildReasons({
      skillScore,
      skill,
      workloadScore,
      load,
      availabilityScore,
      freeMinutes,
      experienceScore,
      seniority: iv.seniority,
      timezoneScore,
      spread,
      repeat,
      effectiveSkills,
    });

    scored.push({
      interviewerId: iv.id,
      userId: iv.userId,
      name: iv.user.name,
      email: iv.user.email,
      title: iv.title,
      seniority: iv.seniority,
      timezone: iv.user.timezone,
      avatarSeed: iv.user.avatarSeed,
      yearsExperience: iv.yearsExperience,
      interviewTypes: csvToArray(iv.interviewTypesCsv),
      skills: offeredByInterviewer.get(iv.id),
      matchScore: Math.round(Math.max(0, Math.min(100, total))),
      breakdown: {
        skill: Math.round(skillScore),
        workload: workloadScore,
        availability: availabilityScore,
        experience: experienceScore,
        timezone: timezoneScore,
        repeatPenalty: repeat ? -6 : 0,
      },
      perSkill: skill?.per_skill ?? [],
      skillMethod: skill?.method ?? 'none',
      workload: load,
      freeMinutes,
      freeWindows: free.free,
      preferredWindows: free.preferred,
      workingHours: {
        startMinute: iv.workStartMinute,
        endMinute: iv.workEndMinute,
        weekdays: isoWeekdayList(iv.workDaysCsv),
      },
      maxInterviewsPerDay: iv.maxInterviewsPerDay,
      reasons,
    });
  }

  scored.sort((a, b) => b.matchScore - a.matchScore);

  return {
    ranked: scored.slice(0, limit),
    rejected,
    aiProvider,
    fallbackUsed,
    weights: MATCH_WEIGHTS,
    consideredCount: all.length,
    eligibleCount: scored.length,
  };
}

function expectedSeniority(interviewType) {
  switch (interviewType) {
    case 'SYSTEM_DESIGN': return 4;
    case 'MANAGERIAL': return 4;
    case 'TECHNICAL': return 3;
    case 'CODING': return 2;
    case 'HR': return 2;
    default: return 3;
  }
}

function buildReasons({
  skillScore, skill, workloadScore, load, availabilityScore, freeMinutes,
  experienceScore, seniority, timezoneScore, spread, repeat, effectiveSkills,
}) {
  const reasons = [];

  if (effectiveSkills.length) {
    const matched = (skill?.per_skill || []).filter((s) => s.score >= 60).map((s) => s.skill);
    const missing = (skill?.per_skill || []).filter((s) => s.score < 40).map((s) => s.skill);
    reasons.push({
      factor: 'Skill match',
      score: Math.round(skillScore),
      detail:
        matched.length
          ? `${Math.round(skillScore)}% match, covers ${matched.slice(0, 4).join(', ')}${missing.length ? `; gaps: ${missing.slice(0, 3).join(', ')}` : ''}`
          : `${Math.round(skillScore)}% match against required skills`,
    });
  }

  reasons.push({
    factor: 'Workload',
    score: workloadScore,
    detail: `${load.upcomingCount}/${load.maxPerWeek} interviews this week (${load.level.toLowerCase()} load)`,
  });
  reasons.push({
    factor: 'Availability',
    score: availabilityScore,
    detail: `${Math.round(freeMinutes / 60)}h free in the requested window`,
  });
  reasons.push({
    factor: 'Seniority fit',
    score: experienceScore,
    detail: `${seniority} level for this round type`,
  });
  reasons.push({
    factor: 'Timezone',
    score: timezoneScore,
    detail: spread === 0 ? 'Same timezone as candidate' : `${spread.toFixed(1)}h offset from candidate`,
  });
  if (repeat) {
    reasons.push({ factor: 'Repeat interviewer', score: -6, detail: 'Has already interviewed this candidate in an earlier round' });
  }
  return reasons;
}

/** Interviewer ids who have already met this candidate (any round, any status). */
async function previousInterviewerIds(candidateId) {
  const seats = await prisma.interviewPanelMember.findMany({
    where: { interview: { request: { application: { candidateId } } } },
    select: { interviewerId: true },
  });
  return new Set(seats.map((s) => s.interviewerId));
}

/**
 * Equivalent-replacement search used by the Control Tower: who else could take
 * this exact interview at this exact time?
 */
export async function findReplacements({ interview, leavingInterviewerId, limit = 5 }) {
  const request = await prisma.interviewRequest.findUnique({
    where: { id: interview.requestId },
    include: { application: { include: { candidate: { include: { user: true } } } } },
  });

  const keepIds = interview.panel
    .filter((p) => p.interviewerId !== leavingInterviewerId && p.responseStatus !== 'DECLINED')
    .map((p) => p.interviewerId);

  const { ranked, rejected } = await rankInterviewers({
    request,
    rangeStart: new Date(interview.startUtc),
    rangeEnd: new Date(interview.endUtc),
    excludeInterviewerIds: [leavingInterviewerId, ...keepIds],
    excludeInterviewId: interview.id,
    limit: 30,
  });

  // Must be genuinely free for the *exact* slot, not merely free somewhere in range.
  const startMs = new Date(interview.startUtc).getTime();
  const endMs = new Date(interview.endUtc).getTime();

  const viable = ranked.filter((r) =>
    r.freeWindows.some((w) => new Date(w.start).getTime() <= startMs && new Date(w.end).getTime() >= endMs)
  );

  return { replacements: viable.slice(0, limit), consideredButUnavailable: ranked.length - viable.length, rejected };
}

export { ACTIVE_INTERVIEW_STATUSES };
