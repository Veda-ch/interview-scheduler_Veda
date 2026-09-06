/**
 * One canonical API shape for an interview, used by every role's endpoints so
 * the frontend has a single contract. Sensitive fields are only included when
 * the caller's role warrants it.
 */
import { parseArray, parseObject } from '../lib/json.js';
import { humanSlot } from '../lib/time.js';
import { INTERVIEW_STATUS } from '../../../shared/constants.js';

export function shapeInterview(iv, { viewerTimezone = 'UTC', viewerRole, includeFeedback = false } = {}) {
  if (!iv) return null;
  const app = iv.request?.application;

  return {
    id: iv.id,
    requestId: iv.requestId,
    status: iv.status,
    candidateResponse: iv.candidateResponse,
    candidateResponseNote: iv.candidateResponseNote ?? null,
    startUtc: iv.startUtc,
    endUtc: iv.endUtc,
    durationMinutes: Math.round((new Date(iv.endUtc) - new Date(iv.startUtc)) / 60000),
    localLabel: humanSlot(iv.startUtc, iv.endUtc, viewerTimezone),
    actualStartUtc: iv.actualStartUtc ?? null,
    actualEndUtc: iv.actualEndUtc ?? null,
    scheduleScore: iv.scheduleScore,
    riskScore: iv.riskScore,
    resilienceScore: iv.resilienceScore ?? null,
    reasons: parseArray(iv.reasonsJson),
    engineUsed: iv.engineUsed,
    cancelReason: iv.cancelReason ?? null,
    rescheduledFromId: iv.rescheduledFromId ?? null,
    version: iv.version,
    round: iv.request
      ? {
          number: iv.request.roundNumber,
          name: iv.request.roundName,
          type: iv.request.interviewType,
          bufferMinutes: iv.request.bufferMinutes,
          focusTopics: parseArray(iv.request.focusTopicsJson),
          requiredSkills: parseArray(iv.request.requiredSkillsJson),
        }
      : null,
    job: app?.job ? { id: app.job.id, title: app.job.title, department: app.job.department } : null,
    candidate: app?.candidate
      ? {
          id: app.candidate.id,
          name: app.candidate.user?.name,
          email: viewerRole === 'CANDIDATE' ? undefined : app.candidate.user?.email,
          timezone: app.candidate.user?.timezone,
          headline: app.candidate.headline,
        }
      : null,
    panel: (iv.panel || []).map((p) => ({
      id: p.id,
      interviewerId: p.interviewerId,
      name: p.interviewer?.user?.name,
      title: p.interviewer?.title,
      timezone: p.interviewer?.user?.timezone,
      role: p.role,
      responseStatus: p.responseStatus,
      declineReason: p.declineReason ?? null,
      matchScore: p.matchScore,
      matchReasons: parseArray(p.matchReasonsJson),
      respondedAt: p.respondedAt,
    })),
    meeting: iv.meeting
      ? {
          provider: iv.meeting.provider,
          joinUrl: iv.meeting.joinUrl,
          passcode: iv.meeting.passcode,
          status: iv.meeting.status,
        }
      : null,
    calendarEvent: iv.calendarEvent
      ? {
          provider: iv.calendarEvent.provider,
          externalId: iv.calendarEvent.externalId,
          htmlLink: iv.calendarEvent.htmlLink,
          status: iv.calendarEvent.status,
          syncError: iv.calendarEvent.syncError,
        }
      : null,
    health: iv.scores?.length
      ? {
          healthScore: iv.scores[0].healthScore,
          conflictRisk: iv.scores[0].conflictRisk,
          cascadeRisk: iv.scores[0].cascadeRisk,
          interviewerLoad: iv.scores[0].interviewerLoad,
          candidateInconvenience: iv.scores[0].candidateInconvenience,
          waitingRisk: iv.scores[0].waitingRisk,
          timezoneRisk: iv.scores[0].timezoneRisk,
          bufferQuality: iv.scores[0].bufferQuality,
          breakdown: parseObject(iv.scores[0].breakdownJson),
          computedAt: iv.scores[0].computedAt,
        }
      : null,
    incidents: (iv.incidents || []).map((i) => ({
      id: i.id,
      type: i.type,
      severity: i.severity,
      status: i.status,
      title: i.title,
      detectedAt: i.detectedAt,
    })),
    feedback: includeFeedback
      ? (iv.feedback || []).map((f) => ({
          id: f.id,
          interviewerId: f.interviewerId,
          overallRating: f.overallRating,
          recommendation: f.recommendation,
          ratings: parseObject(f.ratingsJson),
          comments: f.comments,
          aiAnalysis: parseObject(f.aiAnalysisJson),
          submittedAt: f.submittedAt,
        }))
      : (iv.feedback || []).length,
    isJoinable:
      [INTERVIEW_STATUS.SCHEDULED, INTERVIEW_STATUS.CONFIRMED, INTERVIEW_STATUS.IN_PROGRESS].includes(iv.status) &&
      Date.now() > new Date(iv.startUtc).getTime() - 15 * 60000 &&
      Date.now() < new Date(iv.endUtc).getTime() + 30 * 60000,
    createdAt: iv.createdAt,
    updatedAt: iv.updatedAt,
  };
}

/** Include block that satisfies shapeInterview completely. */
export const fullInterviewInclude = {
  request: {
    include: {
      application: {
        include: {
          // The recruiter is the calendar-event organiser and the approval
          // target for high-risk recoveries, so it must always be loaded.
          job: { include: { recruiter: { include: { user: { select: { id: true, name: true, email: true, timezone: true } } } } } },
          candidate: { include: { user: { select: { id: true, name: true, email: true, timezone: true } } } },
        },
      },
    },
  },
  panel: {
    include: {
      interviewer: { include: { user: { select: { id: true, name: true, email: true, timezone: true } } } },
    },
  },
  meeting: true,
  calendarEvent: true,
  feedback: true,
  incidents: { where: { status: { notIn: ['RESOLVED', 'DISMISSED'] } } },
  scores: { orderBy: { computedAt: 'desc' }, take: 1 },
};
