/**
 * THE CONTROL TOWER
 *
 * Lifecycle: DETECT -> ANALYSE IMPACT -> GENERATE RECOVERY OPTIONS -> SIMULATE
 * -> RANK -> (AUTO-APPLY | REQUEST APPROVAL) -> NOTIFY -> AUDIT
 *
 * Two invariants make this safe rather than reckless:
 *
 *  1. AUTONOMY POLICY. Every recovery strategy carries a risk level
 *     (shared/constants.js STRATEGY_RISK). Only strategies at or below the
 *     configured ceiling (default LOW) are applied without a human. Everything
 *     else is written to the database as a proposed plan and waits for the
 *     recruiter. "Self-healing" here means bounded autonomy, not a free hand.
 *
 *  2. NO PRIVILEGED PATH. Recovery applies changes through the same
 *     orchestration functions a recruiter uses, so the double-booking guard,
 *     buffer checks and audit trail apply identically to automated actions.
 */
import prisma from '../lib/prisma.js';
import logger from '../lib/logger.js';
import { notFound, conflict, badRequest } from '../lib/errors.js';
import { parseArray, parseObject, stringifyJson } from '../lib/json.js';
import { recordAudit } from './audit.service.js';
import { notify, interviewContext } from './notification.service.js';
import { findReplacements } from './matching.service.js';
import { generateProposals } from './scheduling.service.js';
import {
  replaceInterviewer,
  shiftInterview,
  cancelInterview,
  attachMeetingAndCalendar,
  getInterview,
} from './orchestration.service.js';
import { fullInterviewInclude } from './interview.shape.js';
import { getSettings } from './settings.service.js';
import { callAiService } from '../providers/aiClient.js';
import { addMinutes, humanSlot } from '../lib/time.js';
import {
  AUDIT_ACTIONS,
  NOTIFICATION_TYPES,
  INCIDENT_TYPES,
  INCIDENT_STATUS,
  SEVERITY,
  RECOVERY_STRATEGY,
  STRATEGY_RISK,
  RISK_LEVEL,
  RISK_ORDER,
  SETTING_KEYS,
  ACTIVE_INTERVIEW_STATUSES,
  INTERVIEW_STATUS,
  PANEL_RESPONSE,
} from '../../../shared/constants.js';

/** Stable key so the monitor cannot raise the same incident every minute. */
const dedupeKeyFor = ({ interviewId, type, bucket = '' }) => `${type}:${interviewId || 'global'}:${bucket}`;

// ---------------------------------------------------------------------------
// 1. DETECT
// ---------------------------------------------------------------------------

/**
 * Raise an incident and drive it through the whole pipeline.
 * Idempotent on `dedupeKey`.
 */
export async function raiseIncident({
  interviewId = null,
  type,
  severity = SEVERITY.MEDIUM,
  title,
  description,
  detectedBy = 'MONITOR',
  context = {},
  bucket = '',
  autoRecover = true,
}) {
  const dedupeKey = dedupeKeyFor({ interviewId, type, bucket });

  const existing = await prisma.incident.findUnique({ where: { dedupeKey } });
  if (existing) {
    logger.debug('Incident already tracked', { dedupeKey, status: existing.status });
    return existing;
  }

  const incident = await prisma.incident.create({
    data: {
      interviewId,
      type,
      severity,
      status: INCIDENT_STATUS.OPEN,
      title,
      description,
      detectedBy,
      dedupeKey,
      impactJson: stringifyJson({ context }),
    },
  });

  await recordAudit({
    actorRole: detectedBy === 'USER' ? 'USER' : 'SYSTEM',
    action: AUDIT_ACTIONS.INCIDENT_DETECTED,
    entity: 'Incident',
    entityId: incident.id,
    summary: `${type}: ${title}`,
    metadata: { interviewId, severity, detectedBy },
  });

  if (!autoRecover) return incident;

  try {
    return await processIncident(incident.id, { context });
  } catch (err) {
    logger.error('Incident processing failed', { incidentId: incident.id, error: err.message });
    await prisma.incident.update({
      where: { id: incident.id },
      data: { status: INCIDENT_STATUS.FAILED, description: `${description}\n\nRecovery planning failed: ${err.message}` },
    });
    await recordAudit({
      actorRole: 'SYSTEM', action: AUDIT_ACTIONS.RECOVERY_FAILED, entity: 'Incident', entityId: incident.id,
      summary: `Recovery planning failed: ${err.message}`,
    });
    return prisma.incident.findUnique({ where: { id: incident.id } });
  }
}

// ---------------------------------------------------------------------------
// 2. ANALYSE IMPACT
// ---------------------------------------------------------------------------

/**
 * Who and what does this incident touch, and how far does it cascade?
 * Cascade depth = later rounds for the same application that are already
 * scheduled or that depend on this round completing.
 */
export async function analyzeImpact(interview) {
  if (!interview) return { affectedPeople: [], downstream: [], cascadeDepth: 0, severityHint: SEVERITY.LOW };

  const app = interview.request.application;

  const affectedPeople = [
    {
      role: 'CANDIDATE',
      userId: app.candidate.userId,
      name: app.candidate.user.name,
      timezone: app.candidate.user.timezone,
      impact: 'Interview time may change; needs to be informed and to re-confirm.',
    },
    ...interview.panel.map((p) => ({
      role: 'INTERVIEWER',
      userId: p.interviewer.userId,
      interviewerId: p.interviewerId,
      name: p.interviewer.user.name,
      timezone: p.interviewer.user.timezone,
      responseStatus: p.responseStatus,
      impact: p.responseStatus === PANEL_RESPONSE.DECLINED ? 'Has left the panel.' : 'May need to re-confirm.',
    })),
  ];
  if (app.job.recruiter) {
    affectedPeople.push({
      role: 'RECRUITER',
      userId: app.job.recruiter.userId,
      name: app.job.recruiter.user.name,
      timezone: app.job.recruiter.user.timezone,
      impact: 'Owns the decision if the recovery is high-risk.',
    });
  }

  // Downstream rounds for the same candidate.
  const laterRequests = await prisma.interviewRequest.findMany({
    where: { applicationId: app.id, roundNumber: { gt: interview.request.roundNumber } },
    include: {
      interviews: { where: { status: { in: ACTIVE_INTERVIEW_STATUSES } }, orderBy: { startUtc: 'asc' } },
    },
    orderBy: { roundNumber: 'asc' },
  });

  const downstream = laterRequests.map((r) => ({
    requestId: r.id,
    roundNumber: r.roundNumber,
    roundName: r.roundName,
    status: r.status,
    scheduledAt: r.interviews[0]?.startUtc ?? null,
    interviewId: r.interviews[0]?.id ?? null,
    blocked: r.dependsOnRequestId === interview.requestId,
  }));

  // Same-day interviews for the same candidate that a time shift would collide with.
  const dayStart = new Date(interview.startUtc);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = addMinutes(dayStart, 24 * 60);
  const sameDay = await prisma.interview.findMany({
    where: {
      id: { not: interview.id },
      status: { in: ACTIVE_INTERVIEW_STATUSES },
      startUtc: { gte: dayStart, lt: dayEnd },
      request: { application: { candidateId: app.candidateId } },
    },
    select: { id: true, startUtc: true, endUtc: true, request: { select: { roundName: true } } },
  });

  const cascadeDepth = downstream.filter((d) => d.blocked || d.scheduledAt).length;

  return {
    interviewId: interview.id,
    slotLabel: humanSlot(interview.startUtc, interview.endUtc, app.candidate.user.timezone),
    affectedPeople,
    downstream,
    sameDayInterviews: sameDay.map((s) => ({
      id: s.id,
      roundName: s.request.roundName,
      startUtc: s.startUtc,
      endUtc: s.endUtc,
    })),
    cascadeDepth,
    hoursUntilStart: Math.round(((interview.startUtc - Date.now()) / 3600000) * 10) / 10,
    severityHint:
      cascadeDepth >= 2 ? SEVERITY.CRITICAL : cascadeDepth === 1 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
  };
}

// ---------------------------------------------------------------------------
// 3. GENERATE RECOVERY OPTIONS
// ---------------------------------------------------------------------------

/**
 * Produce concrete, executable recovery plans for an incident.
 * Each plan carries a machine-readable payload so applying it is mechanical.
 */
async function generateRecoveryPlans(incident, interview, impact, context) {
  const plans = [];
  const settings = await getSettings();

  const push = (plan) =>
    plans.push({
      ...plan,
      riskLevel: STRATEGY_RISK[plan.strategy] || RISK_LEVEL.HIGH,
    });

  switch (incident.type) {
    // ---------------------------------------------------------------- panel
    case INCIDENT_TYPES.INTERVIEWER_DECLINED:
    case INCIDENT_TYPES.INTERVIEWER_UNAVAILABLE: {
      const leavingId =
        context.leavingInterviewerId ||
        interview.panel.find((p) => p.responseStatus === PANEL_RESPONSE.DECLINED)?.interviewerId ||
        interview.panel[0]?.interviewerId;

      const { replacements, consideredButUnavailable } = await findReplacements({
        interview,
        leavingInterviewerId: leavingId,
        limit: 4,
      });

      for (const r of replacements) {
        push({
          strategy: RECOVERY_STRATEGY.REPLACE_INTERVIEWER,
          description: `Assign ${r.name} to the same slot (${humanSlot(interview.startUtc, interview.endUtc, r.timezone)} their time)`,
          score: 60 + r.matchScore * 0.4,
          disruptionScore: 10, // nobody's time changes; only the panel does
          payload: { outgoingInterviewerId: leavingId, incomingInterviewerId: r.interviewerId },
          reasons: [
            `${r.matchScore}% skill match for this round`,
            `Free for the exact slot (no other change needed)`,
            `${r.workload.upcomingCount}/${r.workload.maxPerWeek} interviews this week (${r.workload.level.toLowerCase()} load)`,
            r.timezone === interview.request.application.candidate.user.timezone
              ? 'Same timezone as the candidate'
              : `Timezone ${r.timezone}, slot still inside their working hours`,
            'No downstream interview is affected',
          ],
        });
      }

      // Panel can shrink if it is bigger than the minimum the round requires.
      const remaining = interview.panel.filter((p) => p.interviewerId !== leavingId && p.responseStatus !== PANEL_RESPONSE.DECLINED);
      if (remaining.length >= 1 && interview.panel.length > 1) {
        push({
          strategy: RECOVERY_STRATEGY.REDUCE_PANEL,
          description: `Run the interview with the remaining ${remaining.length} interviewer(s)`,
          score: 45,
          disruptionScore: 25,
          payload: { keepInterviewerIds: remaining.map((p) => p.interviewerId) },
          reasons: [
            'Time and candidate are unaffected',
            `Panel drops from ${interview.panel.length} to ${remaining.length}`,
            'Less interview signal collected for this round',
          ],
        });
      }

      if (!replacements.length) {
        push({
          strategy: RECOVERY_STRATEGY.RESCHEDULE_SLOT,
          description: 'No qualified interviewer is free at this time - find a new slot entirely',
          score: 30,
          disruptionScore: 70,
          payload: { regenerate: true },
          reasons: [
            `${consideredButUnavailable} qualified interviewer(s) exist but none are free for this exact slot`,
            'The candidate will need to accept a new time',
            `${impact.cascadeDepth} downstream round(s) may shift`,
          ],
        });
      }
      break;
    }

    // ------------------------------------------------------------- timing
    case INCIDENT_TYPES.INTERVIEW_OVERRUN: {
      const overrunMinutes = context.overrunMinutes || 10;
      const nextForPanel = context.nextInterview;

      push({
        strategy: RECOVERY_STRATEGY.NOTIFY_ONLY,
        description: `Notify the participants of the next interview that it may start ~${overrunMinutes} minutes late`,
        score: 70,
        disruptionScore: overrunMinutes,
        payload: { notifyInterviewId: nextForPanel?.id ?? null, overrunMinutes },
        reasons: [
          `The current interview is ${overrunMinutes} minutes past its scheduled end`,
          nextForPanel
            ? `The next interview for this panel starts at ${new Date(nextForPanel.startUtc).toISOString()}`
            : 'No immediately following interview for this panel',
          'Expectation management costs nothing and changes no bookings',
        ],
      });

      if (nextForPanel) {
        push({
          strategy: RECOVERY_STRATEGY.SHIFT_TIME,
          description: `Push the next interview back by ${Math.ceil(overrunMinutes / 5) * 5} minutes`,
          score: 55,
          disruptionScore: overrunMinutes * 2,
          payload: { shiftInterviewId: nextForPanel.id, minutes: Math.ceil(overrunMinutes / 5) * 5 },
          reasons: [
            'Keeps the panel intact and the same day',
            'The next candidate is told the new time immediately',
            'Requires the next candidate to accept a small change',
          ],
        });
      }
      break;
    }

    // ---------------------------------------------------- candidate-driven
    case INCIDENT_TYPES.RESCHEDULE_REQUESTED:
    case INCIDENT_TYPES.CANDIDATE_CANCELLED: {
      push({
        strategy: RECOVERY_STRATEGY.RESCHEDULE_SLOT,
        description: 'Generate a fresh set of ranked slots and propose them to the candidate',
        score: 65,
        disruptionScore: 55,
        payload: { regenerate: true, cancelCurrent: true },
        reasons: [
          'The candidate explicitly asked for a different time',
          'Panel availability is re-checked from scratch',
          `${impact.cascadeDepth} downstream round(s) will be re-evaluated`,
        ],
      });
      push({
        strategy: RECOVERY_STRATEGY.CANCEL_AND_REQUEUE,
        description: 'Cancel this interview and return the round to the pending queue',
        score: 35,
        disruptionScore: 80,
        payload: { cancel: true },
        reasons: [
          'Frees the panel immediately',
          'The recruiter decides when to re-open scheduling',
          'The candidate stays in the pipeline',
        ],
      });
      break;
    }

    case INCIDENT_TYPES.CANDIDATE_NO_SHOW: {
      push({
        strategy: RECOVERY_STRATEGY.NOTIFY_ONLY,
        description: 'Alert the recruiter and release the panel, keeping the record as NO_SHOW',
        score: 60,
        disruptionScore: 30,
        payload: { markNoShow: true },
        reasons: [
          'The candidate did not join within the grace period',
          'The panel is released for other work',
          'The recruiter decides whether to re-engage the candidate',
        ],
      });
      break;
    }

    // ------------------------------------------------------- integrations
    case INCIDENT_TYPES.MEETING_LINK_FAILURE: {
      push({
        strategy: RECOVERY_STRATEGY.REGENERATE_MEETING,
        description: 'Regenerate the meeting link and re-notify the participants',
        score: 90,
        disruptionScore: 3,
        payload: { regenerateMeeting: true },
        reasons: [
          'Nothing about the schedule changes',
          'Participants receive a fresh working join link',
          'Fully reversible and low risk',
        ],
      });
      break;
    }

    case INCIDENT_TYPES.CALENDAR_SYNC_FAILURE: {
      push({
        strategy: RECOVERY_STRATEGY.RETRY_SYNC,
        description: 'Retry the calendar sync for this interview',
        score: 88,
        disruptionScore: 2,
        payload: { retrySync: true },
        reasons: [
          'The interview itself is valid in the portal regardless',
          'Calendar providers commonly fail transiently',
          'No participant-visible change if it succeeds',
        ],
      });
      break;
    }

    case INCIDENT_TYPES.UNCONFIRMED_IMMINENT: {
      push({
        strategy: RECOVERY_STRATEGY.NOTIFY_ONLY,
        description: 'Send an urgent confirmation reminder to everyone who has not responded',
        score: 85,
        disruptionScore: 2,
        payload: { remindUnconfirmed: true },
        reasons: [
          `Interview starts in ${impact.hoursUntilStart}h with unconfirmed participants`,
          'A reminder is the least intrusive intervention',
          'Escalates automatically if still unconfirmed closer to the time',
        ],
      });
      break;
    }

    case INCIDENT_TYPES.INTERVIEWER_OVERLOAD: {
      push({
        strategy: RECOVERY_STRATEGY.NOTIFY_ONLY,
        description: 'Flag the overloaded interviewer to the recruiter for rebalancing',
        score: 70,
        disruptionScore: 5,
        payload: { notifyRecruiterOnly: true },
        reasons: [
          'Load ceilings are the interviewer\'s own declared limits',
          'Rebalancing future rounds is a recruiter decision',
          'No scheduled interview is changed automatically',
        ],
      });
      break;
    }

    default: {
      push({
        strategy: RECOVERY_STRATEGY.NOTIFY_ONLY,
        description: 'Notify the recruiter for manual handling',
        score: 40,
        disruptionScore: 10,
        payload: {},
        reasons: ['No automated strategy matches this incident type'],
      });
    }
  }

  // --- Simulate each plan's residual risk so ranking is not pure heuristic.
  if (interview && plans.length) {
    await simulatePlans(plans, interview, impact, settings);
  }

  // --- Rank: benefit minus disruption, with a small bonus for lower risk.
  for (const p of plans) {
    p.finalScore =
      p.score * 0.6 -
      p.disruptionScore * 0.3 +
      (4 - RISK_ORDER[p.riskLevel]) * 5 +
      (p.residualResilience ? p.residualResilience * 0.1 : 0);
  }
  plans.sort((a, b) => b.finalScore - a.finalScore);
  if (plans.length) plans[0].isRecommended = true;

  return plans;
}

/** Ask the Monte-Carlo simulator how each recovered schedule would hold up. */
async function simulatePlans(plans, interview, impact, settings) {
  const { computeWorkloadBulk } = await import('./interviewer.service.js');
  const loads = await computeWorkloadBulk(interview.panel.map((p) => p.interviewerId));
  const baseUtil = interview.panel.map((p) => loads.get(p.interviewerId)?.utilization ?? 0.5);

  const payload = {
    iterations: Math.min(settings[SETTING_KEYS.SIMULATION_ITERATIONS] || 200, 500),
    schedules: plans.map((p, i) => ({
      id: String(i),
      start_utc: new Date(interview.startUtc).toISOString(),
      end_utc: new Date(interview.endUtc).toISOString(),
      // A plan that shifts time changes the buffer picture.
      buffer_minutes:
        p.strategy === RECOVERY_STRATEGY.SHIFT_TIME
          ? Math.max(0, interview.request.bufferMinutes - 5)
          : interview.request.bufferMinutes,
      panel: (p.strategy === RECOVERY_STRATEGY.REDUCE_PANEL ? baseUtil.slice(0, -1) : baseUtil).map((u, idx) => ({
        id: `p${idx}`,
        utilization: u,
        timezone: interview.panel[idx]?.interviewer.user.timezone || 'UTC',
        backup_count: p.strategy === RECOVERY_STRATEGY.REPLACE_INTERVIEWER ? 2 : 1,
      })),
      candidate_timezone: interview.request.application.candidate.user.timezone,
      days_out: Math.max(0, (interview.startUtc - Date.now()) / 86400000),
      downstream_interviews: impact.cascadeDepth,
    })),
  };

  const res = await callAiService('/schedule/simulate', payload, { timeoutMs: 12000 });
  if (!res.ok || !Array.isArray(res.data?.results)) return;

  res.data.results.forEach((r) => {
    const plan = plans[Number(r.id)];
    if (!plan) return;
    plan.residualResilience = r.resilience_score;
    plan.reasons.push(
      `Simulated: resilience ${r.resilience_score}/100 after this recovery, ${Math.round(r.recovery_rate * 100)}% of remaining disruptions self-recoverable`
    );
  });
}

// ---------------------------------------------------------------------------
// 4. DRIVE THE INCIDENT (rank -> autonomy decision -> apply or ask)
// ---------------------------------------------------------------------------

export async function processIncident(incidentId, { context = {} } = {}) {
  const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!incident) throw notFound('Incident not found');

  await prisma.incident.update({ where: { id: incidentId }, data: { status: INCIDENT_STATUS.ANALYZING } });

  const interview = incident.interviewId
    ? await prisma.interview.findUnique({ where: { id: incident.interviewId }, include: fullInterviewInclude })
    : null;

  const storedContext = parseObject(incident.impactJson).context || {};
  const mergedContext = { ...storedContext, ...context };

  // --- IMPACT
  const impact = await analyzeImpact(interview);
  await prisma.incident.update({
    where: { id: incidentId },
    data: {
      impactJson: stringifyJson({ ...impact, context: mergedContext }),
      severity: incident.severity === SEVERITY.CRITICAL ? incident.severity : impact.severityHint || incident.severity,
    },
  });
  await recordAudit({
    actorRole: 'SYSTEM',
    action: AUDIT_ACTIONS.IMPACT_ANALYZED,
    entity: 'Incident',
    entityId: incidentId,
    summary: `Impact: ${impact.affectedPeople?.length || 0} people, ${impact.cascadeDepth || 0} downstream round(s)`,
    metadata: impact,
  });

  // --- PLANS
  const plans = await generateRecoveryPlans(incident, interview, impact, mergedContext);

  const savedPlans = [];
  for (const p of plans) {
    savedPlans.push(
      await prisma.recoveryPlan.create({
        data: {
          incidentId,
          strategy: p.strategy,
          description: p.description,
          score: Math.round(p.finalScore * 10) / 10,
          disruptionScore: p.disruptionScore,
          riskLevel: p.riskLevel,
          payloadJson: stringifyJson(p.payload),
          reasonsJson: stringifyJson(p.reasons),
          isRecommended: Boolean(p.isRecommended),
        },
      })
    );
  }

  await recordAudit({
    actorRole: 'SYSTEM',
    action: AUDIT_ACTIONS.RECOVERY_PLANNED,
    entity: 'Incident',
    entityId: incidentId,
    summary: `${savedPlans.length} recovery option(s) generated; recommended: ${savedPlans.find((p) => p.isRecommended)?.strategy || 'none'}`,
    metadata: { plans: savedPlans.map((p) => ({ strategy: p.strategy, risk: p.riskLevel, score: p.score })) },
  });

  const recommended = savedPlans.find((p) => p.isRecommended);
  if (!recommended) {
    await prisma.incident.update({ where: { id: incidentId }, data: { status: INCIDENT_STATUS.AWAITING_APPROVAL } });
    return prisma.incident.findUnique({ where: { id: incidentId } });
  }

  // --- AUTONOMY DECISION
  const settings = await getSettings();
  const ceiling = String(settings[SETTING_KEYS.AUTONOMY_AUTO_APPLY_MAX_RISK] || RISK_LEVEL.LOW).toUpperCase();
  const mayAutoApply = RISK_ORDER[recommended.riskLevel] <= (RISK_ORDER[ceiling] ?? 1);

  const action = await prisma.recoveryAction.create({
    data: {
      incidentId,
      planId: recommended.id,
      action: recommended.strategy,
      status: mayAutoApply ? 'PENDING' : 'AWAITING_APPROVAL',
      requiresApproval: !mayAutoApply,
      reason: mayAutoApply
        ? `Auto-applied: ${recommended.riskLevel} risk is at or below the ${ceiling} autonomy ceiling`
        : `${recommended.riskLevel} risk exceeds the ${ceiling} autonomy ceiling - recruiter approval required`,
    },
  });

  if (mayAutoApply) {
    await prisma.incident.update({ where: { id: incidentId }, data: { status: INCIDENT_STATUS.RECOVERING } });
    return applyRecoveryPlan({ incidentId, planId: recommended.id, actionId: action.id, actor: null, automatic: true });
  }

  await prisma.incident.update({ where: { id: incidentId }, data: { status: INCIDENT_STATUS.AWAITING_APPROVAL } });
  await notifyRecruiterForApproval(incident, interview, recommended);
  return prisma.incident.findUnique({ where: { id: incidentId }, include: { plans: true, actions: true } });
}

async function notifyRecruiterForApproval(incident, interview, plan) {
  const recruiterUserId = interview?.request?.application?.job?.recruiter?.userId;
  if (!recruiterUserId) return;
  await notify({
    userId: recruiterUserId,
    type: NOTIFICATION_TYPES.APPROVAL_REQUIRED,
    context: {
      ...(interview ? interviewContext(interview) : {}),
      incidentTitle: incident.title,
      incidentDescription: incident.description,
      planDescription: plan.description,
      riskLevel: plan.riskLevel,
    },
    relatedEntity: 'Incident',
    relatedId: incident.id,
  });
}

// ---------------------------------------------------------------------------
// 5. APPLY
// ---------------------------------------------------------------------------

/** Execute a plan's payload through the normal orchestration paths. */
export async function applyRecoveryPlan({ incidentId, planId, actionId = null, actor = null, automatic = false }) {
  const [incident, plan] = await Promise.all([
    prisma.incident.findUnique({ where: { id: incidentId } }),
    prisma.recoveryPlan.findUnique({ where: { id: planId } }),
  ]);
  if (!incident || !plan || plan.incidentId !== incidentId) throw notFound('Recovery plan not found for this incident');
  if (plan.status === 'APPLIED') throw conflict('This recovery plan has already been applied', 'ALREADY_APPLIED');

  const payload = parseObject(plan.payloadJson);
  const interview = incident.interviewId
    ? await prisma.interview.findUnique({ where: { id: incident.interviewId }, include: fullInterviewInclude })
    : null;

  const action =
    (actionId && (await prisma.recoveryAction.findUnique({ where: { id: actionId } }))) ||
    (await prisma.recoveryAction.create({
      data: {
        incidentId, planId, action: plan.strategy, status: 'PENDING',
        requiresApproval: !automatic, approvedById: actor?.id ?? null,
        approvedAt: actor ? new Date() : null,
      },
    }));

  let result = {};
  try {
    result = await executeStrategy({ plan, payload, incident, interview, actor, automatic });

    await prisma.$transaction([
      prisma.recoveryPlan.update({ where: { id: planId }, data: { status: 'APPLIED' } }),
      prisma.recoveryPlan.updateMany({
        where: { incidentId, id: { not: planId }, status: 'PROPOSED' },
        data: { status: 'REJECTED' },
      }),
      prisma.recoveryAction.update({
        where: { id: action.id },
        data: {
          status: 'APPLIED',
          autoApplied: automatic,
          appliedAt: new Date(),
          approvedById: actor?.id ?? null,
          resultJson: stringifyJson(result),
        },
      }),
      prisma.incident.update({
        where: { id: incidentId },
        data: { status: INCIDENT_STATUS.RESOLVED, resolvedAt: new Date() },
      }),
    ]);

    await recordAudit({
      actorUserId: actor?.id ?? null,
      actorRole: actor?.role ?? 'SYSTEM',
      action: AUDIT_ACTIONS.RECOVERY_APPLIED,
      entity: 'Incident',
      entityId: incidentId,
      summary: `${automatic ? 'Automatically applied' : 'Applied'}: ${plan.description}`,
      metadata: { strategy: plan.strategy, riskLevel: plan.riskLevel, automatic, result, reasons: parseArray(plan.reasonsJson) },
    });

    await notifyRecoveryApplied(incident, plan, automatic);
  } catch (err) {
    logger.error('Recovery application failed', { incidentId, planId, error: err.message });
    await prisma.recoveryAction.update({
      where: { id: action.id },
      data: { status: 'FAILED', resultJson: stringifyJson({ error: err.message }) },
    });
    await prisma.recoveryPlan.update({ where: { id: planId }, data: { status: 'FAILED' } });
    await prisma.incident.update({
      where: { id: incidentId },
      data: { status: INCIDENT_STATUS.AWAITING_APPROVAL, description: `${incident.description}\n\nAutomatic recovery failed: ${err.message}` },
    });
    await recordAudit({
      actorUserId: actor?.id ?? null, actorRole: actor?.role ?? 'SYSTEM',
      action: AUDIT_ACTIONS.RECOVERY_FAILED, entity: 'Incident', entityId: incidentId,
      summary: `Recovery failed: ${err.message}`,
      metadata: { strategy: plan.strategy },
    });
    throw err;
  }

  return prisma.incident.findUnique({
    where: { id: incidentId },
    include: { plans: true, actions: { orderBy: { createdAt: 'desc' } } },
  });
}

async function executeStrategy({ plan, payload, incident, interview, actor }) {
  switch (plan.strategy) {
    case RECOVERY_STRATEGY.REPLACE_INTERVIEWER: {
      await replaceInterviewer({
        interviewId: interview.id,
        outgoingInterviewerId: payload.outgoingInterviewerId,
        incomingInterviewerId: payload.incomingInterviewerId,
        reason: plan.description,
        actor,
      });
      return { replaced: true, ...payload };
    }

    case RECOVERY_STRATEGY.REDUCE_PANEL: {
      const removeIds = interview.panel
        .map((p) => p.interviewerId)
        .filter((id) => !payload.keepInterviewerIds.includes(id));
      for (const id of removeIds) {
        const seat = interview.panel.find((p) => p.interviewerId === id);
        await prisma.$transaction([
          prisma.interviewPanelMember.deleteMany({ where: { interviewId: interview.id, interviewerId: id } }),
          prisma.booking.deleteMany({ where: { interviewId: interview.id, userId: seat.interviewer.userId } }),
        ]);
      }
      return { removedInterviewerIds: removeIds };
    }

    case RECOVERY_STRATEGY.SHIFT_TIME: {
      const targetId = payload.shiftInterviewId || interview.id;
      await shiftInterview({ interviewId: targetId, minutes: payload.minutes, reason: plan.description, actor });
      return { shiftedInterviewId: targetId, minutes: payload.minutes };
    }

    case RECOVERY_STRATEGY.REGENERATE_MEETING: {
      await prisma.meeting.deleteMany({ where: { interviewId: interview.id } });
      await attachMeetingAndCalendar(interview.id);
      const meeting = await prisma.meeting.findUnique({ where: { interviewId: interview.id } });
      if (!meeting || meeting.status !== 'ACTIVE') throw new Error('Meeting regeneration did not produce an active link');
      return { joinUrl: meeting.joinUrl, provider: meeting.provider };
    }

    case RECOVERY_STRATEGY.RETRY_SYNC: {
      await prisma.calendarEventRecord.deleteMany({ where: { interviewId: interview.id } });
      await attachMeetingAndCalendar(interview.id);
      const record = await prisma.calendarEventRecord.findUnique({ where: { interviewId: interview.id } });
      if (!record || record.status === 'SYNC_FAILED') throw new Error('Calendar sync failed again');
      return { calendarStatus: record.status, externalId: record.externalId };
    }

    case RECOVERY_STRATEGY.RESCHEDULE_SLOT: {
      if (payload.cancelCurrent && interview) {
        await cancelInterview({
          interviewId: interview.id,
          reason: `Superseded by recovery: ${plan.description}`,
          actor,
          notifyParticipants: false,
        });
      }
      const requestId = interview?.requestId || payload.requestId;
      const generated = await generateProposals(requestId, { excludeInterviewId: interview?.id });
      // Tell the candidate new options are waiting.
      const request = await prisma.interviewRequest.findUnique({
        where: { id: requestId },
        include: { application: { include: { candidate: { include: { user: true } }, job: true } } },
      });
      await notify({
        userId: request.application.candidate.userId,
        type: NOTIFICATION_TYPES.SLOTS_PROPOSED,
        context: {
          jobTitle: request.application.job.title,
          roundName: request.roundName,
          slotCount: generated.proposals.length,
          slotLabel: generated.proposals[0]?.localLabels?.candidate ?? 'see your dashboard',
        },
        relatedEntity: 'InterviewRequest',
        relatedId: requestId,
        personalize: true,
      });
      return { proposalCount: generated.proposals.length, engineUsed: generated.engineUsed, requestId };
    }

    case RECOVERY_STRATEGY.CANCEL_AND_REQUEUE: {
      await cancelInterview({ interviewId: interview.id, reason: plan.description, actor });
      return { cancelled: true };
    }

    case RECOVERY_STRATEGY.NOTIFY_ONLY: {
      return notifyOnlyStrategy({ payload, incident, interview });
    }

    default:
      throw new Error(`Unknown recovery strategy: ${plan.strategy}`);
  }
}

async function notifyOnlyStrategy({ payload, incident, interview }) {
  const sent = [];

  if (payload.markNoShow && interview) {
    await prisma.$transaction([
      prisma.interview.update({
        where: { id: interview.id },
        data: { status: INTERVIEW_STATUS.NO_SHOW, actualEndUtc: new Date(), version: { increment: 1 } },
      }),
      prisma.booking.deleteMany({ where: { interviewId: interview.id } }),
    ]);
    sent.push('marked NO_SHOW and released the panel');
  }

  if (payload.remindUnconfirmed && interview) {
    const targets = [];
    if (interview.candidateResponse === 'PENDING') {
      targets.push({ userId: interview.request.application.candidate.userId, zone: interview.request.application.candidate.user.timezone });
    }
    for (const p of interview.panel.filter((x) => x.responseStatus === PANEL_RESPONSE.PENDING)) {
      targets.push({ userId: p.interviewer.userId, zone: p.interviewer.user.timezone });
    }
    for (const t of targets) {
      await notify({
        userId: t.userId,
        type: NOTIFICATION_TYPES.INTERVIEW_REMINDER,
        context: interviewContext(interview, { viewerTimezone: t.zone }),
        relatedEntity: 'Interview',
        relatedId: interview.id,
      });
    }
    sent.push(`reminded ${targets.length} unconfirmed participant(s)`);
  }

  if (payload.notifyInterviewId) {
    const next = await prisma.interview.findUnique({
      where: { id: payload.notifyInterviewId },
      include: fullInterviewInclude,
    });
    if (next) {
      await notify({
        userId: next.request.application.candidate.userId,
        type: NOTIFICATION_TYPES.INTERVIEW_REMINDER,
        context: interviewContext(next, {
          viewerTimezone: next.request.application.candidate.user.timezone,
          extra: { reason: `The preceding interview is running about ${payload.overrunMinutes} minutes late.` },
        }),
        relatedEntity: 'Interview',
        relatedId: next.id,
        personalize: true,
      });
      sent.push('warned the next candidate about the delay');
    }
  }

  if (payload.notifyRecruiterOnly || !sent.length) {
    const recruiterUserId = interview?.request?.application?.job?.recruiter?.userId;
    if (recruiterUserId) {
      await notify({
        userId: recruiterUserId,
        type: NOTIFICATION_TYPES.INCIDENT_RAISED,
        context: {
          ...(interview ? interviewContext(interview) : {}),
          incidentTitle: incident.title,
          incidentDescription: incident.description,
        },
        channels: ['IN_APP'],
        relatedEntity: 'Incident',
        relatedId: incident.id,
      });
      sent.push('notified the recruiter');
    }
  }

  return { notifications: sent };
}

async function notifyRecoveryApplied(incident, plan, automatic) {
  if (!incident.interviewId) return;
  const interview = await prisma.interview.findUnique({
    where: { id: incident.interviewId },
    include: fullInterviewInclude,
  });
  if (!interview) return;

  const recruiterUserId = interview.request.application.job.recruiter?.userId;
  if (recruiterUserId) {
    await notify({
      userId: recruiterUserId,
      type: NOTIFICATION_TYPES.RECOVERY_APPLIED,
      context: interviewContext(interview, {
        extra: { reason: `${automatic ? 'Automatically resolved' : 'Resolved'}: ${plan.description}` },
      }),
      channels: ['IN_APP'],
      relatedEntity: 'Incident',
      relatedId: incident.id,
    });
  }
}

// ---------------------------------------------------------------------------
// 6. Human decisions
// ---------------------------------------------------------------------------

export async function approveIncidentRecovery({ incidentId, planId, actor }) {
  const incident = await prisma.incident.findUnique({ where: { id: incidentId }, include: { plans: true } });
  if (!incident) throw notFound('Incident not found');
  if (incident.status === INCIDENT_STATUS.RESOLVED) throw conflict('This incident is already resolved', 'ALREADY_RESOLVED');

  const chosen = planId
    ? incident.plans.find((p) => p.id === planId)
    : incident.plans.find((p) => p.isRecommended) || incident.plans[0];
  if (!chosen) throw badRequest('No recovery plan available to approve');

  await recordAudit({
    actorUserId: actor.id, actorRole: actor.role,
    action: AUDIT_ACTIONS.RECOVERY_APPROVED, entity: 'Incident', entityId: incidentId,
    summary: `Approved: ${chosen.description}`,
    metadata: { planId: chosen.id, strategy: chosen.strategy, riskLevel: chosen.riskLevel },
  });

  return applyRecoveryPlan({ incidentId, planId: chosen.id, actor, automatic: false });
}

export async function dismissIncident({ incidentId, reason, actor }) {
  const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!incident) throw notFound('Incident not found');

  await prisma.$transaction([
    prisma.incident.update({
      where: { id: incidentId },
      data: { status: INCIDENT_STATUS.DISMISSED, resolvedAt: new Date() },
    }),
    prisma.recoveryPlan.updateMany({ where: { incidentId, status: 'PROPOSED' }, data: { status: 'REJECTED' } }),
    prisma.recoveryAction.updateMany({
      where: { incidentId, status: 'AWAITING_APPROVAL' },
      data: { status: 'REJECTED', reason: reason ?? 'Dismissed by recruiter' },
    }),
  ]);

  await recordAudit({
    actorUserId: actor.id, actorRole: actor.role,
    action: AUDIT_ACTIONS.RECOVERY_REJECTED, entity: 'Incident', entityId: incidentId,
    summary: `Incident dismissed${reason ? `: ${reason}` : ''}`,
  });

  return prisma.incident.findUnique({ where: { id: incidentId }, include: { plans: true, actions: true } });
}

// ---------------------------------------------------------------------------
// 7. Read models for the dashboard
// ---------------------------------------------------------------------------

export function shapeIncident(row) {
  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    status: row.status,
    title: row.title,
    description: row.description,
    detectedBy: row.detectedBy,
    detectedAt: row.detectedAt,
    resolvedAt: row.resolvedAt,
    impact: parseObject(row.impactJson),
    interview: row.interview
      ? {
          id: row.interview.id,
          startUtc: row.interview.startUtc,
          endUtc: row.interview.endUtc,
          status: row.interview.status,
          roundName: row.interview.request?.roundName,
          jobTitle: row.interview.request?.application?.job?.title,
          candidateName: row.interview.request?.application?.candidate?.user?.name,
          panel: (row.interview.panel || []).map((p) => ({
            name: p.interviewer?.user?.name,
            responseStatus: p.responseStatus,
          })),
        }
      : null,
    plans: (row.plans || []).map((p) => ({
      id: p.id,
      strategy: p.strategy,
      description: p.description,
      score: p.score,
      disruptionScore: p.disruptionScore,
      riskLevel: p.riskLevel,
      isRecommended: p.isRecommended,
      status: p.status,
      reasons: parseArray(p.reasonsJson),
      payload: parseObject(p.payloadJson),
    })),
    actions: (row.actions || []).map((a) => ({
      id: a.id,
      action: a.action,
      status: a.status,
      requiresApproval: a.requiresApproval,
      autoApplied: a.autoApplied,
      appliedAt: a.appliedAt,
      reason: a.reason,
      result: parseObject(a.resultJson),
    })),
  };
}

export async function listIncidents({ status, severity, take = 50, includeResolved = false } = {}) {
  const where = {};
  if (status) where.status = status;
  else if (!includeResolved) where.status = { notIn: [INCIDENT_STATUS.RESOLVED, INCIDENT_STATUS.DISMISSED] };
  if (severity) where.severity = severity;

  const rows = await prisma.incident.findMany({
    where,
    include: {
      interview: {
        include: {
          request: { include: { application: { include: { job: true, candidate: { include: { user: true } } } } } },
          panel: { include: { interviewer: { include: { user: true } } } },
        },
      },
      plans: { orderBy: { score: 'desc' } },
      actions: { orderBy: { createdAt: 'desc' } },
    },
    orderBy: [{ status: 'asc' }, { detectedAt: 'desc' }],
    take: Math.min(take, 200),
  });
  return rows.map(shapeIncident);
}

export async function getIncident(incidentId) {
  const row = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      interview: {
        include: {
          request: { include: { application: { include: { job: true, candidate: { include: { user: true } } } } } },
          panel: { include: { interviewer: { include: { user: true } } } },
        },
      },
      plans: { orderBy: { score: 'desc' } },
      actions: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!row) throw notFound('Incident not found');
  return shapeIncident(row);
}

/** The Control Tower snapshot that powers the main dashboard. */
export async function controlTowerSnapshot() {
  const now = new Date();
  const in24h = addMinutes(now, 24 * 60);
  const last7d = addMinutes(now, -7 * 24 * 60);

  const [active, upcoming, incidents, recentRecoveries, scores, unconfirmed] = await Promise.all([
    prisma.interview.findMany({
      where: { status: INTERVIEW_STATUS.IN_PROGRESS },
      include: fullInterviewInclude,
      orderBy: { startUtc: 'asc' },
    }),
    prisma.interview.findMany({
      where: { status: { in: ACTIVE_INTERVIEW_STATUSES }, startUtc: { gte: now, lte: in24h } },
      include: fullInterviewInclude,
      orderBy: { startUtc: 'asc' },
      take: 25,
    }),
    listIncidents({ take: 30 }),
    prisma.recoveryAction.findMany({
      where: { status: 'APPLIED', appliedAt: { gte: last7d } },
      include: { plan: true, incident: true },
      orderBy: { appliedAt: 'desc' },
      take: 20,
    }),
    prisma.scheduleScore.findMany({
      where: {
        computedAt: { gte: last7d },
        interview: { status: { in: ACTIVE_INTERVIEW_STATUSES } },
      },
      orderBy: { computedAt: 'desc' },
    }),
    prisma.interview.count({
      where: {
        status: { in: ACTIVE_INTERVIEW_STATUSES },
        startUtc: { gte: now, lte: in24h },
        OR: [{ candidateResponse: 'PENDING' }, { panel: { some: { responseStatus: PANEL_RESPONSE.PENDING } } }],
      },
    }),
  ]);

  // Average of the most recent score per interview (avoid double-counting rescoring).
  const latestByInterview = new Map();
  for (const s of scores) if (!latestByInterview.has(s.interviewId)) latestByInterview.set(s.interviewId, s);
  const latest = [...latestByInterview.values()];
  const avg = (arr, key) => (arr.length ? Math.round((arr.reduce((a, b) => a + b[key], 0) / arr.length) * 10) / 10 : null);

  const atRisk = latest.filter((s) => s.healthScore < 70);

  const { shapeInterview } = await import('./interview.shape.js');

  return {
    generatedAt: now,
    summary: {
      activeNow: active.length,
      upcoming24h: upcoming.length,
      openIncidents: incidents.filter((i) => !['RESOLVED', 'DISMISSED'].includes(i.status)).length,
      awaitingApproval: incidents.filter((i) => i.status === INCIDENT_STATUS.AWAITING_APPROVAL).length,
      atRiskSchedules: atRisk.length,
      unconfirmedNext24h: unconfirmed,
      automaticRecoveries7d: recentRecoveries.filter((r) => r.autoApplied).length,
      manualRecoveries7d: recentRecoveries.filter((r) => !r.autoApplied).length,
      averageScheduleHealth: avg(latest, 'healthScore'),
      averageConflictRisk: avg(latest, 'conflictRisk'),
      averageCascadeRisk: avg(latest, 'cascadeRisk'),
    },
    activeInterviews: active.map((i) => ({
      ...shapeInterview(i),
      overrunMinutes:
        i.status === INTERVIEW_STATUS.IN_PROGRESS && now > i.endUtc
          ? Math.round((now - i.endUtc) / 60000)
          : 0,
    })),
    upcomingInterviews: upcoming.map((i) => shapeInterview(i)),
    incidents,
    recentRecoveries: recentRecoveries.map((r) => ({
      id: r.id,
      action: r.action,
      autoApplied: r.autoApplied,
      appliedAt: r.appliedAt,
      description: r.plan?.description,
      riskLevel: r.plan?.riskLevel,
      incidentTitle: r.incident?.title,
      incidentType: r.incident?.type,
    })),
    autonomyPolicy: await autonomyPolicyView(),
  };
}

export async function autonomyPolicyView() {
  const settings = await getSettings();
  const ceiling = String(settings[SETTING_KEYS.AUTONOMY_AUTO_APPLY_MAX_RISK] || RISK_LEVEL.LOW).toUpperCase();
  return {
    autoApplyCeiling: ceiling,
    strategies: Object.entries(STRATEGY_RISK).map(([strategy, risk]) => ({
      strategy,
      riskLevel: risk,
      autoApplied: RISK_ORDER[risk] <= (RISK_ORDER[ceiling] ?? 1),
      rationale: STRATEGY_RATIONALE[strategy],
    })),
  };
}

const STRATEGY_RATIONALE = {
  NOTIFY_ONLY: 'Sends information only; changes no booking.',
  RETRY_SYNC: 'Retries an external call; invisible to participants if it succeeds.',
  REGENERATE_MEETING: 'Replaces a broken join link; the time and panel are unchanged.',
  REPLACE_INTERVIEWER: 'Equivalent-skill swap at the same time; the candidate keeps their slot.',
  REDUCE_PANEL: 'Loses interview signal, so a human should decide.',
  SHIFT_TIME: 'Moves a confirmed time; the candidate must be told and may object.',
  RESCHEDULE_SLOT: 'Changes the day; can cascade into later rounds.',
  CANCEL_AND_REQUEUE: 'Removes a scheduled interview entirely.',
};

export { INCIDENT_TYPES, SEVERITY };
