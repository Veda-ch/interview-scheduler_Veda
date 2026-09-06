/**
 * Analytics computed from real rows only.
 *
 * Every metric below is derived from records the application actually wrote
 * (interviews, incidents, recovery actions, schedule scores, audit logs). There
 * are no synthetic numbers, and metrics with no underlying data return null
 * rather than a plausible-looking zero.
 */
import prisma from '../lib/prisma.js';
import { computeWorkloadBulk } from './interviewer.service.js';
import { parseObject } from '../lib/json.js';
import {
  INTERVIEW_STATUS,
  ACTIVE_INTERVIEW_STATUSES,
  AUDIT_ACTIONS,
  INCIDENT_STATUS,
} from '../../../shared/constants.js';

const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null);

export async function overviewMetrics({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 86400000);

  const [
    interviews,
    requests,
    incidents,
    recoveries,
    scores,
    simulations,
    interviewerRows,
    feedbackRows,
  ] = await Promise.all([
    prisma.interview.findMany({
      where: { createdAt: { gte: since } },
      select: {
        id: true, status: true, startUtc: true, endUtc: true, createdAt: true,
        actualStartUtc: true, actualEndUtc: true, candidateResponse: true,
        scheduleScore: true, riskScore: true, resilienceScore: true, engineUsed: true,
        rescheduledFromId: true,
        request: { select: { id: true, createdAt: true, roundNumber: true, applicationId: true } },
      },
    }),
    prisma.interviewRequest.findMany({
      where: { createdAt: { gte: since } },
      select: { id: true, status: true, createdAt: true, failureReason: true },
    }),
    prisma.incident.findMany({
      where: { detectedAt: { gte: since } },
      select: { id: true, type: true, severity: true, status: true, detectedAt: true, resolvedAt: true },
    }),
    prisma.recoveryAction.findMany({
      where: { createdAt: { gte: since } },
      select: { id: true, status: true, autoApplied: true, action: true, appliedAt: true, createdAt: true },
    }),
    prisma.scheduleScore.findMany({
      where: { computedAt: { gte: since } },
      orderBy: { computedAt: 'desc' },
    }),
    prisma.scheduleSimulation.findMany({ where: { createdAt: { gte: since } } }),
    prisma.interviewerProfile.findMany({ where: { isActive: true }, select: { id: true } }),
    prisma.feedback.findMany({ where: { submittedAt: { gte: since } }, select: { overallRating: true, recommendation: true } }),
  ]);

  const total = interviews.length;
  const completed = interviews.filter((i) => i.status === INTERVIEW_STATUS.COMPLETED).length;
  const cancelled = interviews.filter((i) => i.status === INTERVIEW_STATUS.CANCELLED).length;
  const noShows = interviews.filter((i) => i.status === INTERVIEW_STATUS.NO_SHOW).length;
  const rescheduled = interviews.filter((i) => i.rescheduledFromId).length;

  // Time-to-schedule: request created -> interview created.
  const scheduleLatencies = interviews
    .filter((i) => i.request?.createdAt)
    .map((i) => (i.createdAt - i.request.createdAt) / 60000)
    .filter((m) => m >= 0);

  // Candidate waiting: interview created -> interview starts.
  const waitingDays = interviews
    .map((i) => (i.startUtc - i.createdAt) / 86400000)
    .filter((d) => d >= 0);

  // Overrun: only measurable where we have both actual timestamps.
  const overruns = interviews
    .filter((i) => i.actualStartUtc && i.actualEndUtc)
    .map((i) => (i.actualEndUtc - i.actualStartUtc) / 60000 - (i.endUtc - i.startUtc) / 60000);

  // Latest score per interview so rescoring does not skew the average.
  const latestScoreByInterview = new Map();
  for (const s of scores) if (!latestScoreByInterview.has(s.interviewId)) latestScoreByInterview.set(s.interviewId, s);
  const latestScores = [...latestScoreByInterview.values()];

  const workloads = await computeWorkloadBulk(interviewerRows.map((r) => r.id));
  const utils = [...workloads.values()];

  // Conflicts prevented: confirmations that were rejected because the slot was
  // already taken. Counted from the audit trail, not invented.
  const conflictsPrevented = await prisma.auditLog.count({
    where: { createdAt: { gte: since }, action: AUDIT_ACTIONS.UNAUTHORIZED_ACCESS, entity: 'Booking' },
  });
  const slotConflicts = await prisma.auditLog.count({
    where: { createdAt: { gte: since }, action: 'SLOT_CONFLICT_PREVENTED' },
  });

  const appliedRecoveries = recoveries.filter((r) => r.status === 'APPLIED');
  const resolutionMinutes = incidents
    .filter((i) => i.resolvedAt)
    .map((i) => (i.resolvedAt - i.detectedAt) / 60000);

  return {
    windowDays: days,
    generatedAt: new Date(),
    pipeline: {
      totalInterviews: total,
      completed,
      cancelled,
      noShows,
      rescheduled,
      upcoming: interviews.filter((i) => ACTIVE_INTERVIEW_STATUSES.includes(i.status) && i.startUtc > new Date()).length,
      requestsCreated: requests.length,
      requestsFailed: requests.filter((r) => r.status === 'FAILED').length,
      completionRate: pct(completed, total),
      cancellationRate: pct(cancelled, total),
      noShowRate: pct(noShows, total),
      rescheduleRate: pct(rescheduled, total),
      candidateAcceptanceRate: pct(
        interviews.filter((i) => i.candidateResponse === 'ACCEPTED').length,
        interviews.filter((i) => i.candidateResponse !== 'PENDING').length
      ),
    },
    efficiency: {
      averageTimeToScheduleMinutes: avg(scheduleLatencies),
      medianTimeToScheduleMinutes: median(scheduleLatencies),
      averageCandidateWaitingDays: avg(waitingDays),
      averageOverrunMinutes: avg(overruns),
      measuredOverruns: overruns.length,
      engineUsage: countBy(interviews, 'engineUsed'),
      conflictsPrevented: conflictsPrevented + slotConflicts,
    },
    quality: {
      averageScheduleHealth: avg(latestScores.map((s) => s.healthScore)),
      averageConflictRisk: avg(latestScores.map((s) => s.conflictRisk)),
      averageCascadeRisk: avg(latestScores.map((s) => s.cascadeRisk)),
      averageBufferQuality: avg(latestScores.map((s) => s.bufferQuality)),
      averageTimezoneRisk: avg(latestScores.map((s) => s.timezoneRisk)),
      scoredInterviews: latestScores.length,
      averageSlotScore: avg(interviews.map((i) => i.scheduleScore).filter(Boolean)),
      averageResilienceScore: avg(
        [...interviews.map((i) => i.resilienceScore), ...simulations.map((s) => s.resilienceScore)].filter(
          (v) => typeof v === 'number'
        )
      ),
      simulationsRun: simulations.length,
      simulationIterationsTotal: simulations.reduce((a, s) => a + s.iterations, 0),
    },
    resilience: {
      incidentsDetected: incidents.length,
      incidentsResolved: incidents.filter((i) => i.status === INCIDENT_STATUS.RESOLVED).length,
      incidentsOpen: incidents.filter((i) => ![INCIDENT_STATUS.RESOLVED, INCIDENT_STATUS.DISMISSED].includes(i.status)).length,
      awaitingApproval: incidents.filter((i) => i.status === INCIDENT_STATUS.AWAITING_APPROVAL).length,
      automaticRecoveries: appliedRecoveries.filter((r) => r.autoApplied).length,
      manualRecoveries: appliedRecoveries.filter((r) => !r.autoApplied).length,
      recoveryFailures: recoveries.filter((r) => r.status === 'FAILED').length,
      autoRecoveryRate: pct(appliedRecoveries.filter((r) => r.autoApplied).length, appliedRecoveries.length),
      averageResolutionMinutes: avg(resolutionMinutes),
      incidentsByType: countBy(incidents, 'type'),
      incidentsBySeverity: countBy(incidents, 'severity'),
      recoveriesByStrategy: countBy(appliedRecoveries, 'action'),
    },
    interviewers: {
      activeCount: interviewerRows.length,
      averageUtilizationPercent: avg(utils.map((u) => u.utilizationPercent)),
      overloadedCount: utils.filter((u) => u.level === 'OVERLOADED').length,
      highLoadCount: utils.filter((u) => u.level === 'HIGH').length,
      idleCount: utils.filter((u) => u.upcomingCount === 0).length,
    },
    feedback: {
      submitted: feedbackRows.length,
      averageRating: avg(feedbackRows.map((f) => f.overallRating)),
      recommendationBreakdown: countBy(feedbackRows, 'recommendation'),
    },
  };
}

function countBy(rows, key) {
  const out = {};
  for (const r of rows) {
    const k = r[key] ?? 'UNKNOWN';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2) * 10) / 10;
}

/** Interviews per day for the trend chart. */
export async function interviewTrend({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 86400000);
  const rows = await prisma.interview.findMany({
    where: { startUtc: { gte: since } },
    select: { startUtc: true, status: true },
    orderBy: { startUtc: 'asc' },
  });

  const buckets = new Map();
  for (let i = 0; i <= days; i += 1) {
    const d = new Date(since.getTime() + i * 86400000).toISOString().slice(0, 10);
    buckets.set(d, { date: d, scheduled: 0, completed: 0, cancelled: 0, noShow: 0 });
  }
  for (const r of rows) {
    const key = r.startUtc.toISOString().slice(0, 10);
    const b = buckets.get(key);
    if (!b) continue;
    b.scheduled += 1;
    if (r.status === INTERVIEW_STATUS.COMPLETED) b.completed += 1;
    if (r.status === INTERVIEW_STATUS.CANCELLED) b.cancelled += 1;
    if (r.status === INTERVIEW_STATUS.NO_SHOW) b.noShow += 1;
  }
  return [...buckets.values()];
}

/** Per-interviewer utilisation table. */
export async function interviewerUtilization() {
  const rows = await prisma.interviewerProfile.findMany({
    where: { isActive: true },
    include: { user: { select: { name: true, timezone: true } }, skills: { include: { skill: true } } },
  });
  const loads = await computeWorkloadBulk(rows.map((r) => r.id));

  const feedbackCounts = await prisma.feedback.groupBy({
    by: ['interviewerId'],
    _count: { _all: true },
    _avg: { overallRating: true },
  });
  const fbById = new Map(feedbackCounts.map((f) => [f.interviewerId, f]));

  return rows
    .map((r) => {
      const load = loads.get(r.id);
      const fb = fbById.get(r.id);
      return {
        id: r.id,
        name: r.user.name,
        title: r.title,
        timezone: r.user.timezone,
        seniority: r.seniority,
        skills: r.skills.map((s) => s.skill.name),
        upcomingCount: load.upcomingCount,
        maxPerWeek: load.maxPerWeek,
        maxPerDay: load.maxPerDay,
        utilizationPercent: load.utilizationPercent,
        level: load.level,
        busiestDayCount: load.busiestDayCount,
        feedbackSubmitted: fb?._count._all ?? 0,
        averageRatingGiven: fb?._avg.overallRating ? Math.round(fb._avg.overallRating * 10) / 10 : null,
      };
    })
    .sort((a, b) => b.utilizationPercent - a.utilizationPercent);
}

/** Funnel across the hiring pipeline. */
export async function pipelineFunnel() {
  const [applications, requests, interviews, feedback] = await Promise.all([
    prisma.application.count(),
    prisma.interviewRequest.count(),
    prisma.interview.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.feedback.groupBy({ by: ['recommendation'], _count: { _all: true } }),
  ]);

  const byStatus = Object.fromEntries(interviews.map((i) => [i.status, i._count._all]));

  return {
    applications,
    roundsRequested: requests,
    interviewsScheduled: Object.values(byStatus).reduce((a, b) => a + b, 0),
    byStatus,
    feedbackByRecommendation: Object.fromEntries(feedback.map((f) => [f.recommendation, f._count._all])),
  };
}

/** Schedule-health distribution for the histogram. */
export async function healthDistribution() {
  const scores = await prisma.scheduleScore.findMany({
    where: { interview: { status: { in: ACTIVE_INTERVIEW_STATUSES } } },
    orderBy: { computedAt: 'desc' },
  });
  const latest = new Map();
  for (const s of scores) if (!latest.has(s.interviewId)) latest.set(s.interviewId, s);

  const buckets = [
    { range: '0-59 (fragile)', min: 0, max: 60, count: 0 },
    { range: '60-74 (at risk)', min: 60, max: 75, count: 0 },
    { range: '75-89 (healthy)', min: 75, max: 90, count: 0 },
    { range: '90-100 (robust)', min: 90, max: 101, count: 0 },
  ];
  for (const s of latest.values()) {
    const b = buckets.find((x) => s.healthScore >= x.min && s.healthScore < x.max);
    if (b) b.count += 1;
  }
  return {
    buckets,
    total: latest.size,
    worst: [...latest.values()]
      .sort((a, b) => a.healthScore - b.healthScore)
      .slice(0, 5)
      .map((s) => ({
        interviewId: s.interviewId,
        healthScore: s.healthScore,
        drivers: parseObject(s.breakdownJson).components ?? null,
      })),
  };
}
