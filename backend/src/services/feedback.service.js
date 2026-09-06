/**
 * ADAPTIVE INTERVIEW PIPELINE
 *
 *   Interview -> Feedback -> AI analysis -> skill gaps -> next-round focus
 *             -> interviewer matching -> schedule next round
 *
 * The loop that makes the process adaptive rather than fixed. The AI reads
 * language (what did the interviewer actually mean by "weak on SQL"); the
 * deterministic layer decides what to do with it (which skills become required
 * for the next round, which interviewer can probe them).
 */
import prisma from '../lib/prisma.js';
import { notFound, conflict, badRequest } from '../lib/errors.js';
import { parseArray, parseObject, stringifyJson } from '../lib/json.js';
import { analyzeFeedback } from './ai.service.js';
import { recordAudit } from './audit.service.js';
import { rankInterviewers } from './matching.service.js';
import { upsertSkillsByName } from './skill.service.js';
import { AUDIT_ACTIONS, RECOMMENDATION_VALUES, DEFAULT_ROUND_PLAN, REQUEST_STATUS } from '../../../shared/constants.js';

/**
 * Submit feedback for an interview and run the adaptive analysis.
 * One row per (interview, interviewer) - resubmission updates in place.
 */
export async function submitFeedback({ interviewId, interviewerId, payload, actor }) {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: {
      panel: true,
      request: { include: { application: { include: { job: true, candidate: true } } } },
    },
  });
  if (!interview) throw notFound('Interview not found');

  const seat = interview.panel.find((p) => p.interviewerId === interviewerId);
  if (!seat) throw conflict('You are not on this interview panel', 'NOT_ON_PANEL');
  if (!['COMPLETED', 'IN_PROGRESS', 'NO_SHOW'].includes(interview.status)) {
    throw conflict('Feedback can only be submitted once the interview has taken place', 'INVALID_STATE');
  }
  if (!RECOMMENDATION_VALUES.includes(payload.recommendation)) throw badRequest('Invalid recommendation value');

  const requiredSkills = parseArray(interview.request.requiredSkillsJson).map((s) => s.name || s);

  // --- AI analysis of the free text + structured ratings.
  const ai = await analyzeFeedback(
    {
      comments: payload.comments,
      ratings: payload.ratings || {},
      overall_rating: payload.overallRating,
      interview_type: interview.request.interviewType,
      required_skills: requiredSkills,
    },
    { auditContext: { actorUserId: actor?.id, actorRole: actor?.role, entity: 'Interview', entityId: interviewId } }
  );

  const analysis = { ...ai.data, providerUsed: ai.provider, fallbackUsed: ai.fallbackUsed };

  const feedback = await prisma.feedback.upsert({
    where: { interviewId_interviewerId: { interviewId, interviewerId } },
    update: {
      overallRating: payload.overallRating,
      recommendation: payload.recommendation,
      ratingsJson: stringifyJson(payload.ratings || {}),
      comments: payload.comments,
      aiAnalysisJson: stringifyJson(analysis),
      aiProviderUsed: ai.provider,
      submittedAt: new Date(),
    },
    create: {
      interviewId,
      interviewerId,
      overallRating: payload.overallRating,
      recommendation: payload.recommendation,
      ratingsJson: stringifyJson(payload.ratings || {}),
      comments: payload.comments,
      aiAnalysisJson: stringifyJson(analysis),
      aiProviderUsed: ai.provider,
    },
  });

  await recordAudit({
    actorUserId: actor?.id,
    actorRole: actor?.role,
    action: AUDIT_ACTIONS.FEEDBACK_SUBMITTED,
    entity: 'Interview',
    entityId: interviewId,
    summary: `Feedback submitted: ${payload.recommendation}, ${payload.overallRating}/5`,
    metadata: { ratings: payload.ratings },
  });

  await recordAudit({
    actorRole: 'SYSTEM',
    action: AUDIT_ACTIONS.FEEDBACK_ANALYZED,
    entity: 'Interview',
    entityId: interviewId,
    summary:
      `AI analysis (${ai.provider}${ai.fallbackUsed ? ', deterministic fallback' : ''}): ` +
      `strengths [${(analysis.strengths || []).join(', ')}], gaps [${(analysis.skill_gaps || []).join(', ')}]`,
    metadata: analysis,
  });

  // --- Feed the analysis forward into the next round.
  const propagation = await propagateToNextRound({ interview, analysis, actor });

  return { feedback, analysis, ai: { provider: ai.provider, fallbackUsed: ai.fallbackUsed }, propagation };
}

/**
 * Write the identified gaps onto the next round's request as focus topics and
 * required skills. This is what makes the *next* interviewer match different
 * because of what happened in *this* interview.
 */
async function propagateToNextRound({ interview, analysis, actor }) {
  const app = interview.request.application;

  const nextRequest = await prisma.interviewRequest.findFirst({
    where: {
      applicationId: app.id,
      roundNumber: { gt: interview.request.roundNumber },
      status: { in: [REQUEST_STATUS.PENDING, REQUEST_STATUS.PROPOSED] },
    },
    orderBy: { roundNumber: 'asc' },
  });

  const topics = [...new Set([...(analysis.next_round_focus || []), ...(analysis.recommended_topics || [])])].slice(0, 8);
  if (!topics.length) return { applied: false, reason: 'No skill gaps identified' };

  if (!nextRequest) {
    return {
      applied: false,
      reason: 'No pending later round exists yet',
      suggestedFocusTopics: topics,
      suggestedNextRound: suggestNextRound(interview.request.roundNumber),
    };
  }

  // Focus topics become soft requirements; register them in the taxonomy so
  // matching can resolve them.
  await upsertSkillsByName(prisma, topics);

  const existingSkills = parseArray(nextRequest.requiredSkillsJson);
  const merged = [...existingSkills];
  for (const topic of topics) {
    if (!merged.some((s) => (s.name || s).toLowerCase() === topic.toLowerCase())) {
      merged.push({ name: topic, weight: 0.7, mustHave: false, fromFeedback: true });
    }
  }

  await prisma.interviewRequest.update({
    where: { id: nextRequest.id },
    data: { focusTopicsJson: stringifyJson(topics), requiredSkillsJson: stringifyJson(merged) },
  });

  await recordAudit({
    actorUserId: actor?.id ?? null,
    actorRole: actor?.role ?? 'SYSTEM',
    action: AUDIT_ACTIONS.NEXT_ROUND_RECOMMENDED,
    entity: 'InterviewRequest',
    entityId: nextRequest.id,
    summary: `Round ${nextRequest.roundNumber} focus set from round ${interview.request.roundNumber} feedback: ${topics.join(', ')}`,
    metadata: { topics, sourceInterviewId: interview.id, gaps: analysis.skill_gaps },
  });

  // Re-rank interviewers now that the requirements changed, so the recruiter
  // immediately sees a *different* recommendation than before.
  const enriched = await prisma.interviewRequest.findUnique({
    where: { id: nextRequest.id },
    include: { application: { include: { candidate: { include: { user: true } }, job: true } } },
  });

  let recommendedInterviewers = [];
  try {
    const ranked = await rankInterviewers({
      request: enriched,
      rangeStart: new Date(enriched.earliestUtc),
      rangeEnd: new Date(enriched.latestUtc),
      limit: 5,
    });
    recommendedInterviewers = ranked.ranked.map((r) => ({
      id: r.interviewerId,
      name: r.name,
      matchScore: r.matchScore,
      coversFocusTopics: topics.filter((t) =>
        (r.skills || []).some((s) => s.name.toLowerCase() === t.toLowerCase())
      ),
      reasons: r.reasons,
    }));
  } catch (err) {
    recommendedInterviewers = [];
  }

  return {
    applied: true,
    nextRequestId: nextRequest.id,
    nextRoundNumber: nextRequest.roundNumber,
    nextRoundName: nextRequest.roundName,
    focusTopics: topics,
    recommendedInterviewers,
  };
}

const suggestNextRound = (currentRound) =>
  DEFAULT_ROUND_PLAN.find((r) => r.roundNumber === currentRound + 1) || null;

export async function getFeedbackForInterview(interviewId) {
  const rows = await prisma.feedback.findMany({
    where: { interviewId },
    include: { interviewer: { include: { user: { select: { name: true } } } } },
    orderBy: { submittedAt: 'asc' },
  });
  return rows.map((f) => ({
    id: f.id,
    interviewerId: f.interviewerId,
    interviewerName: f.interviewer.user.name,
    overallRating: f.overallRating,
    recommendation: f.recommendation,
    ratings: parseObject(f.ratingsJson),
    comments: f.comments,
    aiAnalysis: parseObject(f.aiAnalysisJson),
    aiProviderUsed: f.aiProviderUsed,
    submittedAt: f.submittedAt,
  }));
}

/** Aggregated view of everything learned about a candidate across rounds. */
export async function candidateSkillProfile(candidateId) {
  const feedback = await prisma.feedback.findMany({
    where: { interview: { request: { application: { candidateId } } } },
    include: {
      interview: { include: { request: true } },
      interviewer: { include: { user: { select: { name: true } } } },
    },
    orderBy: { submittedAt: 'asc' },
  });

  const strengths = new Map();
  const gaps = new Map();
  const timeline = [];

  for (const f of feedback) {
    const a = parseObject(f.aiAnalysisJson);
    for (const s of a.strengths || []) strengths.set(s, (strengths.get(s) || 0) + 1);
    for (const g of a.skill_gaps || []) gaps.set(g, (gaps.get(g) || 0) + 1);
    timeline.push({
      round: f.interview.request.roundNumber,
      roundName: f.interview.request.roundName,
      interviewer: f.interviewer.user.name,
      rating: f.overallRating,
      recommendation: f.recommendation,
      strengths: a.strengths || [],
      gaps: a.skill_gaps || [],
      submittedAt: f.submittedAt,
    });
  }

  const ratings = feedback.map((f) => f.overallRating);

  return {
    candidateId,
    roundsWithFeedback: feedback.length,
    averageRating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
    strengths: [...strengths.entries()].sort((a, b) => b[1] - a[1]).map(([skill, count]) => ({ skill, mentions: count })),
    skillGaps: [...gaps.entries()].sort((a, b) => b[1] - a[1]).map(([skill, count]) => ({ skill, mentions: count })),
    recommendations: feedback.map((f) => f.recommendation),
    timeline,
  };
}
