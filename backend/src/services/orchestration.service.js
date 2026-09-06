/**
 * Interview lifecycle orchestration: confirm, cancel, reschedule, panel
 * responses, start/complete.
 *
 * THE CRITICAL SECTION
 * --------------------
 * Everything that reserves someone's time happens inside a single database
 * transaction that (a) re-verifies availability against the Booking table with
 * the buffer applied, (b) inserts Booking rows protected by a unique constraint,
 * and (c) creates the Interview. Two concurrent confirmations for the same slot
 * cannot both succeed: the loser either fails re-verification or trips the
 * unique index, and gets a clean 409 SLOT_TAKEN.
 *
 * Side effects that can fail without invalidating the booking (meeting link,
 * calendar sync, email) run AFTER the transaction commits and degrade into
 * incidents rather than rollbacks.
 */
import prisma from '../lib/prisma.js';
import logger from '../lib/logger.js';
import { slotTaken, notFound, conflict, badRequest, forbidden } from '../lib/errors.js';
import { addMinutes, humanSlot, timezoneSpreadHours, localMinuteOfDay } from '../lib/time.js';
import { parseArray, parseObject, stringifyJson, csvToArray } from '../lib/json.js';
import { recordAudit } from './audit.service.js';
import { notify, interviewContext } from './notification.service.js';
import { createMeetingSafely } from '../providers/meeting.provider.js';
import { createEventSafely, cancelEventSafely, getCalendarProvider } from '../providers/calendar.provider.js';
import { callAiService } from '../providers/aiClient.js';
import { fullInterviewInclude, shapeInterview } from './interview.shape.js';
import { getSettings } from './settings.service.js';
import {
  AUDIT_ACTIONS,
  NOTIFICATION_TYPES,
  INTERVIEW_STATUS,
  REQUEST_STATUS,
  CANDIDATE_RESPONSE,
  PANEL_RESPONSE,
  ACTIVE_INTERVIEW_STATUSES,
  INCIDENT_TYPES,
  SEVERITY,
  SETTING_KEYS,
  AVAILABILITY_KIND,
} from '../../../shared/constants.js';

const isPostgres = (process.env.DATABASE_PROVIDER || 'sqlite').toLowerCase().startsWith('postgres');

/** Transaction options: Serializable on Postgres; SQLite is already serialised. */
const txOptions = isPostgres ? { isolationLevel: 'Serializable', timeout: 15000 } : { timeout: 15000 };

/**
 * Which interviewers should be seated as ACCEPTED rather than PENDING.
 *
 * Auto-accept requires BOTH:
 *   1. the interviewer opted in (`autoAcceptEnabled`), and
 *   2. a window they *explicitly declared* AVAILABLE/PREFERRED fully covers the
 *      slot.
 *
 * The second condition is deliberately stricter than the solver's feasibility
 * rule, which also accepts the profile's default working hours. Working hours
 * are an assumption; a declared window is a positive statement of consent, and
 * only consent should skip the approval step.
 */
async function resolveAutoAccepted(interviewers, startUtc, endUtc) {
  const optedIn = interviewers.filter((iv) => iv.autoAcceptEnabled);
  if (!optedIn.length) return new Set();

  const covering = await prisma.availabilityWindow.findMany({
    where: {
      userId: { in: optedIn.map((iv) => iv.userId) },
      kind: { in: [AVAILABILITY_KIND.AVAILABLE, AVAILABILITY_KIND.PREFERRED] },
      startUtc: { lte: startUtc },
      endUtc: { gte: endUtc },
    },
    select: { userId: true },
  });

  const coveredUserIds = new Set(covering.map((w) => w.userId));
  return new Set(optedIn.filter((iv) => coveredUserIds.has(iv.userId)).map((iv) => iv.id));
}

/**
 * Re-check that every participant is still free. Runs inside the transaction,
 * immediately before the Booking rows are written.
 */
async function assertNoConflicts(tx, { userIds, startUtc, endUtc, bufferMinutes, excludeInterviewId }) {
  const windowStart = addMinutes(startUtc, -bufferMinutes);
  const windowEnd = addMinutes(endUtc, bufferMinutes);

  const clashes = await tx.booking.findMany({
    where: {
      userId: { in: userIds },
      startUtc: { lt: windowEnd },
      endUtc: { gt: windowStart },
      ...(excludeInterviewId ? { NOT: { interviewId: excludeInterviewId } } : {}),
    },
    include: { user: { select: { name: true } } },
  });

  if (clashes.length) {
    throw slotTaken({
      conflicts: clashes.map((c) => ({
        userName: c.user.name,
        startUtc: c.startUtc,
        endUtc: c.endUtc,
        interviewId: c.interviewId,
      })),
      bufferMinutes,
    });
  }

  // Declared UNAVAILABLE windows are a hard block too (someone may have added
  // one between slot generation and confirmation).
  const blocked = await tx.availabilityWindow.findFirst({
    where: {
      userId: { in: userIds },
      kind: 'UNAVAILABLE',
      startUtc: { lt: endUtc },
      endUtc: { gt: startUtc },
    },
    include: { user: { select: { name: true } } },
  });
  if (blocked) {
    throw conflict(
      `${blocked.user.name} marked that time as unavailable after the slot was proposed.`,
      'PARTICIPANT_UNAVAILABLE',
      { userName: blocked.user.name }
    );
  }
}

/**
 * Confirm a proposed slot and create the interview.
 * @param {object} p
 * @param {string} p.proposalId
 * @param {{id:string, role:string}} p.actor
 * @param {boolean} [p.autoConfirmCandidate] true when the candidate self-booked
 */
export async function confirmProposal({ proposalId, actor, autoConfirmCandidate = false, reason = null }) {
  const proposal = await prisma.slotProposal.findUnique({
    where: { id: proposalId },
    include: {
      request: {
        include: {
          application: {
            include: {
              job: { include: { recruiter: { include: { user: true } } } },
              candidate: { include: { user: true } },
            },
          },
        },
      },
    },
  });
  if (!proposal) throw notFound('Slot proposal not found');
  if (proposal.status !== 'OPEN') {
    throw conflict(`This slot is no longer available (${proposal.status.toLowerCase()}).`, 'PROPOSAL_NOT_OPEN');
  }
  if (proposal.expiresAt && proposal.expiresAt < new Date()) {
    await prisma.slotProposal.update({ where: { id: proposalId }, data: { status: 'EXPIRED' } });
    throw conflict('This proposal has expired. Please generate new slots.', 'PROPOSAL_EXPIRED');
  }
  if (proposal.startUtc <= new Date()) {
    throw conflict('That slot is in the past. Please generate new slots.', 'SLOT_IN_PAST');
  }

  const request = proposal.request;
  const candidate = request.application.candidate;
  const interviewerIds = csvToArray(proposal.interviewerIdsCsv);

  const interviewers = await prisma.interviewerProfile.findMany({
    where: { id: { in: interviewerIds } },
    include: { user: true },
  });
  if (interviewers.length !== interviewerIds.length) {
    throw conflict('One of the proposed interviewers no longer exists.', 'INTERVIEWER_MISSING');
  }
  const inactive = interviewers.find((i) => !i.isActive || !i.user.isActive);
  if (inactive) {
    throw conflict(`${inactive.user.name} is no longer available for interviews.`, 'INTERVIEWER_INACTIVE');
  }

  const userIds = [candidate.userId, ...interviewers.map((i) => i.userId)];

  // Interviewers who opted into auto-accept AND explicitly declared this time
  // free are seated as ACCEPTED - the declaration is the approval, so the
  // interview is scheduled without a round-trip. Everyone else stays PENDING.
  const autoAcceptedIds = await resolveAutoAccepted(interviewers, proposal.startUtc, proposal.endUtc);
  const matchScores = parseObject(proposal.matchScoresJson) || {};

  // ---------------------------- critical section ----------------------------
  const interview = await prisma.$transaction(async (tx) => {
    // Guard against a second active interview for the same request.
    const existing = await tx.interview.findFirst({
      where: { requestId: request.id, status: { in: ACTIVE_INTERVIEW_STATUSES } },
    });
    if (existing) {
      throw conflict('This round already has an active interview scheduled.', 'ALREADY_SCHEDULED', {
        interviewId: existing.id,
      });
    }

    await assertNoConflicts(tx, {
      userIds,
      startUtc: proposal.startUtc,
      endUtc: proposal.endUtc,
      bufferMinutes: request.bufferMinutes,
    });

    const created = await tx.interview.create({
      data: {
        requestId: request.id,
        startUtc: proposal.startUtc,
        endUtc: proposal.endUtc,
        status: INTERVIEW_STATUS.SCHEDULED,
        candidateResponse: autoConfirmCandidate ? CANDIDATE_RESPONSE.ACCEPTED : CANDIDATE_RESPONSE.PENDING,
        scheduleScore: proposal.score,
        riskScore: proposal.riskScore,
        reasonsJson: proposal.reasonsJson,
        engineUsed: proposal.engineUsed,
        createdById: actor?.id ?? null,
      },
    });

    await tx.interviewPanelMember.createMany({
      data: interviewers.map((iv, idx) => {
        const auto = autoAcceptedIds.has(iv.id);
        return {
          interviewId: created.id,
          interviewerId: iv.id,
          role: idx === 0 ? 'PRIMARY' : 'SECONDARY',
          responseStatus: auto ? PANEL_RESPONSE.ACCEPTED : PANEL_RESPONSE.PENDING,
          respondedAt: auto ? new Date() : null,
          matchScore: matchScores[iv.id] ?? 0,
        };
      }),
    });

    // Booking rows are the double-booking guard. The unique index on
    // (userId, startUtc, kind) turns a lost race into a constraint violation.
    await tx.booking.createMany({
      data: userIds.map((userId) => ({
        userId,
        interviewId: created.id,
        startUtc: proposal.startUtc,
        endUtc: proposal.endUtc,
        kind: 'INTERVIEW',
      })),
    });

    await tx.slotProposal.update({ where: { id: proposal.id }, data: { status: 'ACCEPTED' } });
    await tx.slotProposal.updateMany({
      where: { requestId: request.id, id: { not: proposal.id }, status: 'OPEN' },
      data: { status: 'REJECTED' },
    });
    await tx.interviewRequest.update({
      where: { id: request.id },
      data: { status: REQUEST_STATUS.SCHEDULED, failureReason: null },
    });

    return created;
  }, txOptions);
  // -------------------------- end critical section --------------------------

  await recordAudit({
    actorUserId: actor?.id ?? null,
    actorRole: actor?.role ?? 'SYSTEM',
    action: AUDIT_ACTIONS.INTERVIEW_CREATED,
    entity: 'Interview',
    entityId: interview.id,
    summary: `${request.roundName} scheduled for ${humanSlot(proposal.startUtc, proposal.endUtc, candidate.user.timezone)}`,
    metadata: {
      requestId: request.id,
      score: proposal.score,
      risk: proposal.riskScore,
      engine: proposal.engineUsed,
      interviewers: interviewers.map((i) => i.user.name),
      reasons: parseArray(proposal.reasonsJson),
      reason,
      autoAcceptedInterviewers: interviewers.filter((i) => autoAcceptedIds.has(i.id)).map((i) => i.user.name),
    },
  });

  // Auto-acceptance is a decision made on someone's behalf, so it gets its own
  // audit line per interviewer rather than hiding inside the creation metadata.
  for (const iv of interviewers.filter((i) => autoAcceptedIds.has(i.id))) {
    await recordAudit({
      actorUserId: null,
      actorRole: 'SYSTEM',
      action: AUDIT_ACTIONS.PANEL_ACCEPTED,
      entity: 'Interview',
      entityId: interview.id,
      summary: `${iv.user.name} auto-accepted (slot falls inside a declared availability window)`,
      metadata: { interviewerId: iv.id, automatic: true },
    });
  }

  // ---- Post-commit side effects (each independently failable).
  await attachMeetingAndCalendar(interview.id);
  await computeAndStoreHealth(interview.id);
  await notifyInterviewScheduled(interview.id, { autoConfirmCandidate });

  return getInterview(interview.id);
}

/** Create the meeting link and calendar event; failures become incidents. */
export async function attachMeetingAndCalendar(interviewId) {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: fullInterviewInclude,
  });
  if (!interview) return null;

  const app = interview.request.application;
  const jobTitle = app.job.title;

  // --- Meeting
  let meetingRow = interview.meeting;
  if (!meetingRow) {
    const { ok, meeting, error } = await createMeetingSafely({
      interviewId,
      jobTitle,
      roundName: interview.request.roundName,
      startUtc: interview.startUtc,
      endUtc: interview.endUtc,
    });

    if (meeting) {
      meetingRow = await prisma.meeting.create({
        data: {
          interviewId,
          provider: meeting.provider,
          externalId: meeting.externalId,
          joinUrl: meeting.joinUrl,
          hostUrl: meeting.hostUrl ?? null,
          passcode: meeting.passcode ?? null,
          status: ok ? 'ACTIVE' : 'FAILED',
          lastError: ok ? null : String(error).slice(0, 300),
        },
      });
      await recordAudit({
        actorRole: 'SYSTEM',
        action: AUDIT_ACTIONS.MEETING_CREATED,
        entity: 'Interview',
        entityId: interviewId,
        summary: ok
          ? `${meeting.provider} meeting link generated`
          : `Meeting link generation failed (${error}); a placeholder was stored`,
        metadata: { provider: meeting.provider, ok },
      });
    }

    if (!ok) {
      const { raiseIncident } = await import('./controlTower.service.js');
      await raiseIncident({
        interviewId,
        type: INCIDENT_TYPES.MEETING_LINK_FAILURE,
        severity: SEVERITY.MEDIUM,
        title: 'Meeting link could not be created',
        description: `The meeting provider returned an error: ${error}. Participants have no join link yet.`,
        detectedBy: 'SYSTEM',
      });
    }
  }

  // --- Calendar
  if (!interview.calendarEvent) {
    const attendees = [
      { email: app.candidate.user.email, name: app.candidate.user.name },
      ...interview.panel.map((p) => ({ email: p.interviewer.user.email, name: p.interviewer.user.name })),
      { email: app.job.recruiter?.user?.email, name: app.job.recruiter?.user?.name },
    ].filter((a) => a.email);

    const { ok, result, error } = await createEventSafely({
      interviewId,
      organizerUserId: app.job.recruiterId ? app.job.recruiter.userId : app.candidate.userId,
      title: `${interview.request.roundName} - ${jobTitle} - ${app.candidate.user.name}`,
      description:
        `${interview.request.interviewType} interview (round ${interview.request.roundNumber}).\n` +
        `Join: ${meetingRow?.joinUrl || 'see the portal'}\n` +
        `Focus areas: ${parseArray(interview.request.focusTopicsJson).join(', ') || 'general'}`,
      startUtc: interview.startUtc,
      endUtc: interview.endUtc,
      attendees,
      requestConference: false,
    });

    await prisma.calendarEventRecord.create({
      data: {
        interviewId,
        provider: result.provider,
        externalId: result.externalId,
        htmlLink: result.htmlLink ?? null,
        status: ok ? 'CONFIRMED' : 'SYNC_FAILED',
        syncError: ok ? null : String(error).slice(0, 300),
      },
    });

    await recordAudit({
      actorRole: 'SYSTEM',
      action: AUDIT_ACTIONS.CALENDAR_EVENT_CREATED,
      entity: 'Interview',
      entityId: interviewId,
      summary: ok
        ? `Calendar event created (${result.provider}) with ${attendees.length} invitations`
        : `Calendar sync failed: ${error}`,
      metadata: { provider: result.provider, attendees: attendees.length, ok },
    });

    if (!ok) {
      const { raiseIncident } = await import('./controlTower.service.js');
      await raiseIncident({
        interviewId,
        type: INCIDENT_TYPES.CALENDAR_SYNC_FAILURE,
        severity: SEVERITY.LOW,
        title: 'Calendar sync failed',
        description: `The calendar provider rejected the event: ${error}. The interview is still valid in the portal.`,
        detectedBy: 'SYSTEM',
      });
    }
  }

  return getInterview(interviewId);
}

/** Compute the explainable health score for an interview and persist it. */
export async function computeAndStoreHealth(interviewId) {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: fullInterviewInclude,
  });
  if (!interview) return null;

  const app = interview.request.application;
  const candidateZone = app.candidate.user.timezone;
  const zones = [candidateZone, ...interview.panel.map((p) => p.interviewer.user.timezone)];

  const { computeWorkloadBulk } = await import('./interviewer.service.js');
  const loads = await computeWorkloadBulk(interview.panel.map((p) => p.interviewerId));

  // How many later rounds depend on this one?
  const downstream = await prisma.interviewRequest.count({
    where: { applicationId: app.id, roundNumber: { gt: interview.request.roundNumber } },
  });

  // Qualified backups = active interviewers covering this interview type.
  const backupCount = await prisma.interviewerProfile.count({
    where: {
      isActive: true,
      interviewTypesCsv: { contains: interview.request.interviewType },
      id: { notIn: interview.panel.map((p) => p.interviewerId) },
    },
  });

  const nearestGap = await nearestGapMinutesForParticipants(interview);

  const payload = {
    start_utc: interview.startUtc.toISOString(),
    end_utc: interview.endUtc.toISOString(),
    buffer_minutes: interview.request.bufferMinutes,
    panel_utilizations: interview.panel.map((p) => loads.get(p.interviewerId)?.utilization ?? 0),
    timezone_spread_hours: timezoneSpreadHours(zones, interview.startUtc),
    candidate_local_start_minute: localMinuteOfDay(interview.startUtc, candidateZone),
    days_out: (interview.startUtc - Date.now()) / 86400000,
    downstream_interviews: downstream,
    panel_size: interview.panel.length,
    backup_interviewer_count: backupCount,
    nearest_gap_minutes: nearestGap,
    unconfirmed_participants:
      (interview.candidateResponse === CANDIDATE_RESPONSE.PENDING ? 1 : 0) +
      interview.panel.filter((p) => p.responseStatus === PANEL_RESPONSE.PENDING).length,
  };

  const res = await callAiService('/schedule/health', payload, { timeoutMs: 8000 });

  // Local mirror of the same heuristic keeps health available when the service is down.
  const h = res.ok ? res.data : localHealthFallback(payload);

  return prisma.scheduleScore.create({
    data: {
      interviewId,
      healthScore: h.health_score,
      conflictRisk: h.conflict_risk,
      cascadeRisk: h.cascade_risk,
      interviewerLoad: h.interviewer_load,
      candidateInconvenience: h.candidate_inconvenience,
      waitingRisk: h.waiting_risk,
      timezoneRisk: h.timezone_risk,
      bufferQuality: h.buffer_quality,
      breakdownJson: stringifyJson({ ...h.breakdown, computedBy: res.ok ? 'ai-service' : 'backend-fallback' }),
    },
  });
}

/** Same seven components as ai-service/app/services/health.py, kept in sync. */
function localHealthFallback(p) {
  const clamp = (v) => Math.max(0, Math.min(100, v));
  const avgLoad = p.panel_utilizations.length
    ? p.panel_utilizations.reduce((a, b) => a + b, 0) / p.panel_utilizations.length
    : 0;
  const maxLoad = Math.max(0, ...p.panel_utilizations);
  const gapRatio = Math.min(p.nearest_gap_minutes / Math.max(p.buffer_minutes * 2, 30), 1);

  const conflict = clamp((1 - gapRatio) * 60 + maxLoad * 40);
  const cascade = clamp(
    p.downstream_interviews * 18 +
      Math.max(0, p.panel_size - 1) * 10 +
      (p.backup_interviewer_count > 0 ? 0 : 25) +
      p.unconfirmed_participants * 8
  );
  const load = clamp(avgLoad * 100);
  const buffer = clamp(gapRatio * 100);
  const tz = clamp((Math.min(p.timezone_spread_hours, 12) / 12) * 100);
  const m = p.candidate_local_start_minute;
  const cand = m >= 540 && m <= 1020 ? 0 : m >= 480 && m <= 1140 ? 25 : m >= 420 && m <= 1260 ? 55 : 90;
  const waiting = clamp(Math.max(0, p.days_out - 3) * 9);

  const health =
    (100 - conflict) * 0.2 + (100 - cascade) * 0.18 + (100 - load) * 0.16 + buffer * 0.16 +
    (100 - tz) * 0.12 + (100 - cand) * 0.1 + (100 - waiting) * 0.08;

  return {
    health_score: Math.round(clamp(health) * 10) / 10,
    conflict_risk: conflict, cascade_risk: cascade, interviewer_load: load,
    candidate_inconvenience: cand, waiting_risk: waiting, timezone_risk: tz, buffer_quality: buffer,
    breakdown: { note: 'Computed by the backend fallback scorer (AI service unavailable).', inputs: p },
  };
}

async function nearestGapMinutesForParticipants(interview) {
  const userIds = [
    interview.request.application.candidate.userId,
    ...interview.panel.map((p) => p.interviewer.userId),
  ];
  const dayStart = addMinutes(interview.startUtc, -12 * 60);
  const dayEnd = addMinutes(interview.endUtc, 12 * 60);

  const neighbours = await prisma.booking.findMany({
    where: {
      userId: { in: userIds },
      interviewId: { not: interview.id },
      startUtc: { lt: dayEnd },
      endUtc: { gt: dayStart },
    },
  });

  let nearest = 240; // nothing within 4h either side is "plenty of room"
  for (const b of neighbours) {
    const before = (interview.startUtc - b.endUtc) / 60000;
    const after = (b.startUtc - interview.endUtc) / 60000;
    if (before >= 0) nearest = Math.min(nearest, before);
    if (after >= 0) nearest = Math.min(nearest, after);
  }
  return Math.max(0, nearest);
}

async function notifyInterviewScheduled(interviewId, { autoConfirmCandidate }) {
  const interview = await prisma.interview.findUnique({ where: { id: interviewId }, include: fullInterviewInclude });
  if (!interview) return;
  const app = interview.request.application;

  await notify({
    userId: app.candidate.userId,
    type: autoConfirmCandidate ? NOTIFICATION_TYPES.INTERVIEW_CONFIRMED : NOTIFICATION_TYPES.INTERVIEW_SCHEDULED,
    context: interviewContext(interview, { viewerTimezone: app.candidate.user.timezone }),
    relatedEntity: 'Interview',
    relatedId: interviewId,
    personalize: true,
  });

  for (const seat of interview.panel) {
    await notify({
      userId: seat.interviewer.userId,
      type: NOTIFICATION_TYPES.INTERVIEWER_ASSIGNED,
      context: interviewContext(interview, { viewerTimezone: seat.interviewer.user.timezone }),
      relatedEntity: 'Interview',
      relatedId: interviewId,
    });
  }

  if (app.job.recruiter?.userId) {
    await notify({
      userId: app.job.recruiter.userId,
      type: NOTIFICATION_TYPES.INTERVIEW_SCHEDULED,
      context: interviewContext(interview, { viewerTimezone: app.job.recruiter.user.timezone }),
      channels: ['IN_APP'],
      relatedEntity: 'Interview',
      relatedId: interviewId,
    });
  }
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export async function candidateRespond({ interviewId, response, note, actor }) {
  const interview = await prisma.interview.findUnique({ where: { id: interviewId }, include: fullInterviewInclude });
  if (!interview) throw notFound('Interview not found');
  if (!ACTIVE_INTERVIEW_STATUSES.includes(interview.status)) {
    throw conflict(`This interview is ${interview.status.toLowerCase()} and cannot be responded to.`, 'INVALID_STATE');
  }

  const updated = await prisma.interview.update({
    where: { id: interviewId },
    data: {
      candidateResponse: response,
      candidateResponseNote: note ?? null,
      status: response === CANDIDATE_RESPONSE.ACCEPTED ? INTERVIEW_STATUS.CONFIRMED : interview.status,
      version: { increment: 1 },
    },
  });

  await recordAudit({
    actorUserId: actor?.id,
    actorRole: actor?.role,
    action: response === CANDIDATE_RESPONSE.ACCEPTED ? AUDIT_ACTIONS.INTERVIEW_CONFIRMED : AUDIT_ACTIONS.INTERVIEW_DECLINED,
    entity: 'Interview',
    entityId: interviewId,
    summary: `Candidate response: ${response}${note ? ` - "${String(note).slice(0, 120)}"` : ''}`,
  });

  const recruiterUserId = interview.request.application.job.recruiter?.userId;

  if (response === CANDIDATE_RESPONSE.ACCEPTED && recruiterUserId) {
    await notify({
      userId: recruiterUserId,
      type: NOTIFICATION_TYPES.INTERVIEW_CONFIRMED,
      context: interviewContext(interview),
      channels: ['IN_APP'],
      relatedEntity: 'Interview',
      relatedId: interviewId,
    });
  }

  // A decline or reschedule request is an incident: the Control Tower owns it.
  if (response === CANDIDATE_RESPONSE.DECLINED || response === CANDIDATE_RESPONSE.RESCHEDULE_REQUESTED) {
    const { raiseIncident } = await import('./controlTower.service.js');
    await raiseIncident({
      interviewId,
      type:
        response === CANDIDATE_RESPONSE.DECLINED
          ? INCIDENT_TYPES.CANDIDATE_CANCELLED
          : INCIDENT_TYPES.RESCHEDULE_REQUESTED,
      severity: SEVERITY.HIGH,
      title:
        response === CANDIDATE_RESPONSE.DECLINED
          ? 'Candidate declined the interview'
          : 'Candidate requested a reschedule',
      description: note ? `Candidate said: "${String(note).slice(0, 300)}"` : 'No reason provided.',
      detectedBy: 'USER',
    });
  }

  return getInterview(updated.id);
}

export async function panelRespond({ interviewId, interviewerId, response, reason, actor }) {
  const seat = await prisma.interviewPanelMember.findUnique({
    where: { interviewId_interviewerId: { interviewId, interviewerId } },
    include: { interviewer: { include: { user: true } } },
  });
  if (!seat) throw notFound('You are not on this interview panel');

  await prisma.interviewPanelMember.update({
    where: { id: seat.id },
    data: { responseStatus: response, declineReason: reason ?? null, respondedAt: new Date() },
  });

  await recordAudit({
    actorUserId: actor?.id,
    actorRole: actor?.role,
    action: response === PANEL_RESPONSE.ACCEPTED ? AUDIT_ACTIONS.PANEL_ACCEPTED : AUDIT_ACTIONS.PANEL_DECLINED,
    entity: 'Interview',
    entityId: interviewId,
    summary: `${seat.interviewer.user.name} ${response.toLowerCase()} the assignment${reason ? `: "${String(reason).slice(0, 120)}"` : ''}`,
  });

  if (response === PANEL_RESPONSE.DECLINED) {
    // Free the declining interviewer's time immediately so they are bookable
    // elsewhere while recovery runs.
    await prisma.booking.deleteMany({ where: { interviewId, userId: seat.interviewer.userId } });

    const { raiseIncident } = await import('./controlTower.service.js');
    await raiseIncident({
      interviewId,
      type: INCIDENT_TYPES.INTERVIEWER_DECLINED,
      severity: SEVERITY.HIGH,
      title: `${seat.interviewer.user.name} declined the interview`,
      description: reason ? `Reason given: "${String(reason).slice(0, 300)}"` : 'No reason provided.',
      detectedBy: 'USER',
      context: { leavingInterviewerId: interviewerId },
    });
  }

  return getInterview(interviewId);
}

// ---------------------------------------------------------------------------
// Cancel / reschedule / lifecycle
// ---------------------------------------------------------------------------

export async function cancelInterview({ interviewId, reason, actor, notifyParticipants = true }) {
  const interview = await prisma.interview.findUnique({ where: { id: interviewId }, include: fullInterviewInclude });
  if (!interview) throw notFound('Interview not found');
  if ([INTERVIEW_STATUS.CANCELLED, INTERVIEW_STATUS.COMPLETED].includes(interview.status)) {
    throw conflict(`Interview is already ${interview.status.toLowerCase()}.`, 'INVALID_STATE');
  }

  await prisma.$transaction(async (tx) => {
    await tx.interview.update({
      where: { id: interviewId },
      data: { status: INTERVIEW_STATUS.CANCELLED, cancelReason: reason ?? null, version: { increment: 1 } },
    });
    // Release everyone's time.
    await tx.booking.deleteMany({ where: { interviewId } });
    await tx.interviewRequest.update({
      where: { id: interview.requestId },
      data: { status: REQUEST_STATUS.PENDING },
    });
  }, txOptions);

  if (interview.calendarEvent && interview.calendarEvent.status !== 'SYNC_FAILED') {
    const res = await cancelEventSafely(interview.calendarEvent.externalId, {
      organizerUserId: interview.request.application.job.recruiter?.userId,
    });
    await prisma.calendarEventRecord.update({
      where: { interviewId },
      data: { status: res.ok ? 'CANCELLED' : 'SYNC_FAILED', syncError: res.ok ? null : String(res.error).slice(0, 300) },
    });
    await recordAudit({
      actorUserId: actor?.id, actorRole: actor?.role ?? 'SYSTEM',
      action: AUDIT_ACTIONS.CALENDAR_EVENT_CANCELLED, entity: 'Interview', entityId: interviewId,
      summary: res.ok ? 'Calendar event cancelled' : `Calendar cancellation failed: ${res.error}`,
    });
  }
  if (interview.meeting) {
    await prisma.meeting.update({ where: { interviewId }, data: { status: 'CANCELLED' } }).catch(() => {});
  }

  await recordAudit({
    actorUserId: actor?.id ?? null,
    actorRole: actor?.role ?? 'SYSTEM',
    action: AUDIT_ACTIONS.INTERVIEW_CANCELLED,
    entity: 'Interview',
    entityId: interviewId,
    summary: `Interview cancelled${reason ? `: ${String(reason).slice(0, 160)}` : ''}`,
  });

  if (notifyParticipants) {
    const app = interview.request.application;
    const targets = [
      { userId: app.candidate.userId, zone: app.candidate.user.timezone },
      ...interview.panel.map((p) => ({ userId: p.interviewer.userId, zone: p.interviewer.user.timezone })),
    ];
    for (const t of targets) {
      await notify({
        userId: t.userId,
        type: NOTIFICATION_TYPES.INTERVIEW_CANCELLED,
        context: interviewContext(interview, { viewerTimezone: t.zone, extra: { reason } }),
        relatedEntity: 'Interview',
        relatedId: interviewId,
      });
    }
  }

  return getInterview(interviewId);
}

/**
 * Move an interview to a new slot (optionally with a new panel) atomically.
 * Used by both the recruiter's manual reschedule and the Control Tower's
 * automated recovery, so the safety checks can never be bypassed.
 */
export async function rescheduleInterview({ interviewId, startUtc, endUtc, interviewerIds, reason, actor }) {
  const interview = await prisma.interview.findUnique({ where: { id: interviewId }, include: fullInterviewInclude });
  if (!interview) throw notFound('Interview not found');
  if (!ACTIVE_INTERVIEW_STATUSES.includes(interview.status)) {
    throw conflict(`Cannot reschedule an interview that is ${interview.status.toLowerCase()}.`, 'INVALID_STATE');
  }
  const start = new Date(startUtc);
  const end = new Date(endUtc);
  if (Number.isNaN(+start) || Number.isNaN(+end) || end <= start) throw badRequest('Invalid new time range');
  if (start <= new Date()) throw badRequest('The new slot must be in the future');

  const app = interview.request.application;
  const newPanelIds = interviewerIds?.length ? interviewerIds : interview.panel.map((p) => p.interviewerId);

  const interviewers = await prisma.interviewerProfile.findMany({
    where: { id: { in: newPanelIds } },
    include: { user: true },
  });
  if (interviewers.length !== newPanelIds.length) throw badRequest('One of the interviewers does not exist');

  const userIds = [app.candidate.userId, ...interviewers.map((i) => i.userId)];

  await prisma.$transaction(async (tx) => {
    // Optimistic lock: refuse if someone changed the interview meanwhile.
    const fresh = await tx.interview.findUnique({ where: { id: interviewId }, select: { version: true, status: true } });
    if (!fresh || fresh.version !== interview.version) {
      throw conflict('This interview was modified by someone else. Reload and try again.', 'STALE_VERSION');
    }

    await tx.booking.deleteMany({ where: { interviewId } });

    await assertNoConflicts(tx, {
      userIds,
      startUtc: start,
      endUtc: end,
      bufferMinutes: interview.request.bufferMinutes,
      excludeInterviewId: interviewId,
    });

    await tx.interview.update({
      where: { id: interviewId },
      data: {
        startUtc: start,
        endUtc: end,
        status: INTERVIEW_STATUS.SCHEDULED,
        candidateResponse: CANDIDATE_RESPONSE.PENDING,
        version: { increment: 1 },
      },
    });

    // Reconcile the panel.
    const currentIds = interview.panel.map((p) => p.interviewerId);
    const removed = currentIds.filter((id) => !newPanelIds.includes(id));
    const added = newPanelIds.filter((id) => !currentIds.includes(id));
    if (removed.length) {
      await tx.interviewPanelMember.deleteMany({ where: { interviewId, interviewerId: { in: removed } } });
    }
    if (added.length) {
      await tx.interviewPanelMember.createMany({
        data: added.map((id) => ({ interviewId, interviewerId: id, role: 'SECONDARY', responseStatus: PANEL_RESPONSE.PENDING })),
      });
    }
    // Anyone who had accepted must re-confirm the new time.
    await tx.interviewPanelMember.updateMany({
      where: { interviewId },
      data: { responseStatus: PANEL_RESPONSE.PENDING, respondedAt: null },
    });

    await tx.booking.createMany({
      data: userIds.map((userId) => ({ userId, interviewId, startUtc: start, endUtc: end, kind: 'INTERVIEW' })),
    });
  }, txOptions);

  // Calendar update (best effort).
  if (interview.calendarEvent && interview.calendarEvent.status === 'CONFIRMED') {
    try {
      const provider = getCalendarProvider();
      await provider.updateEvent(interview.calendarEvent.externalId, {
        organizerUserId: app.job.recruiter?.userId,
        title: `${interview.request.roundName} - ${app.job.title} - ${app.candidate.user.name}`,
        description: `Rescheduled: ${reason || 'scheduling change'}`,
        startUtc: start,
        endUtc: end,
        attendees: [
          { email: app.candidate.user.email },
          ...interviewers.map((i) => ({ email: i.user.email })),
        ],
      });
      await prisma.calendarEventRecord.update({
        where: { interviewId },
        data: { status: 'CONFIRMED', syncError: null, lastSyncedAt: new Date() },
      });
    } catch (err) {
      await prisma.calendarEventRecord.update({
        where: { interviewId },
        data: { status: 'SYNC_FAILED', syncError: err.message.slice(0, 300) },
      });
    }
  }

  await computeAndStoreHealth(interviewId);

  await recordAudit({
    actorUserId: actor?.id ?? null,
    actorRole: actor?.role ?? 'SYSTEM',
    action: AUDIT_ACTIONS.INTERVIEW_RESCHEDULED,
    entity: 'Interview',
    entityId: interviewId,
    summary: `Moved to ${humanSlot(start, end, app.candidate.user.timezone)}${reason ? ` - ${reason}` : ''}`,
    metadata: {
      from: { start: interview.startUtc, end: interview.endUtc },
      to: { start, end },
      panelChanged: JSON.stringify(newPanelIds) !== JSON.stringify(interview.panel.map((p) => p.interviewerId)),
      reason,
    },
  });

  const refreshed = await prisma.interview.findUnique({ where: { id: interviewId }, include: fullInterviewInclude });
  for (const t of [
    { userId: app.candidate.userId, zone: app.candidate.user.timezone },
    ...interviewers.map((i) => ({ userId: i.userId, zone: i.user.timezone })),
  ]) {
    await notify({
      userId: t.userId,
      type: NOTIFICATION_TYPES.INTERVIEW_RESCHEDULED,
      context: interviewContext(refreshed, { viewerTimezone: t.zone, extra: { reason } }),
      relatedEntity: 'Interview',
      relatedId: interviewId,
      personalize: true,
    });
  }

  return getInterview(interviewId);
}

/** Swap one panel member for another at the same time (the recovery workhorse). */
export async function replaceInterviewer({ interviewId, outgoingInterviewerId, incomingInterviewerId, reason, actor }) {
  const interview = await prisma.interview.findUnique({ where: { id: interviewId }, include: fullInterviewInclude });
  if (!interview) throw notFound('Interview not found');

  const incoming = await prisma.interviewerProfile.findUnique({
    where: { id: incomingInterviewerId },
    include: { user: true },
  });
  if (!incoming) throw notFound('Replacement interviewer not found');

  const outgoing = interview.panel.find((p) => p.interviewerId === outgoingInterviewerId);

  // A replacement who opted in and already declared this exact time free should
  // not be asked to approve it either - otherwise an auto-recovery still leaves
  // a pending seat behind, which is the thing auto-accept exists to avoid.
  const autoAcceptedIds = await resolveAutoAccepted([incoming], interview.startUtc, interview.endUtc);
  const incomingAuto = autoAcceptedIds.has(incoming.id);

  await prisma.$transaction(async (tx) => {
    await assertNoConflicts(tx, {
      userIds: [incoming.userId],
      startUtc: interview.startUtc,
      endUtc: interview.endUtc,
      bufferMinutes: interview.request.bufferMinutes,
      excludeInterviewId: interviewId,
    });

    if (outgoing) {
      await tx.interviewPanelMember.delete({ where: { id: outgoing.id } });
      await tx.booking.deleteMany({ where: { interviewId, userId: outgoing.interviewer.userId } });
    }
    await tx.interviewPanelMember.create({
      data: {
        interviewId,
        interviewerId: incomingInterviewerId,
        role: outgoing?.role || 'PRIMARY',
        responseStatus: incomingAuto ? PANEL_RESPONSE.ACCEPTED : PANEL_RESPONSE.PENDING,
        respondedAt: incomingAuto ? new Date() : null,
      },
    });
    await tx.booking.create({
      data: { userId: incoming.userId, interviewId, startUtc: interview.startUtc, endUtc: interview.endUtc, kind: 'INTERVIEW' },
    });
    await tx.interview.update({ where: { id: interviewId }, data: { version: { increment: 1 } } });
  }, txOptions);

  await computeAndStoreHealth(interviewId);

  await recordAudit({
    actorUserId: actor?.id ?? null,
    actorRole: actor?.role ?? 'SYSTEM',
    action: AUDIT_ACTIONS.RECOVERY_APPLIED,
    entity: 'Interview',
    entityId: interviewId,
    summary:
      `${outgoing?.interviewer.user.name || 'A panellist'} replaced by ${incoming.user.name}` +
      (incomingAuto ? ' (auto-accepted from their declared availability)' : ''),
    metadata: { reason, outgoingInterviewerId, incomingInterviewerId, autoAccepted: incomingAuto },
  });

  const refreshed = await prisma.interview.findUnique({ where: { id: interviewId }, include: fullInterviewInclude });
  const app = refreshed.request.application;

  await notify({
    userId: incoming.userId,
    type: NOTIFICATION_TYPES.INTERVIEWER_ASSIGNED,
    context: interviewContext(refreshed, { viewerTimezone: incoming.user.timezone }),
    relatedEntity: 'Interview',
    relatedId: interviewId,
  });
  await notify({
    userId: app.candidate.userId,
    type: NOTIFICATION_TYPES.INTERVIEWER_REPLACED,
    context: interviewContext(refreshed, {
      viewerTimezone: app.candidate.user.timezone,
      extra: { reason: reason || `${incoming.user.name} will now conduct this interview.` },
    }),
    relatedEntity: 'Interview',
    relatedId: interviewId,
    personalize: true,
  });

  return getInterview(interviewId);
}

/** Shift an interview by N minutes, keeping the same day and panel. */
export async function shiftInterview({ interviewId, minutes, reason, actor }) {
  const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
  if (!interview) throw notFound('Interview not found');
  return rescheduleInterview({
    interviewId,
    startUtc: addMinutes(interview.startUtc, minutes),
    endUtc: addMinutes(interview.endUtc, minutes),
    reason: reason || `Shifted by ${minutes} minutes`,
    actor,
  });
}

export async function startInterview({ interviewId, actor }) {
  const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
  if (!interview) throw notFound('Interview not found');
  if (![INTERVIEW_STATUS.SCHEDULED, INTERVIEW_STATUS.CONFIRMED].includes(interview.status)) {
    throw conflict(`Cannot start an interview that is ${interview.status.toLowerCase()}.`, 'INVALID_STATE');
  }
  await prisma.interview.update({
    where: { id: interviewId },
    data: { status: INTERVIEW_STATUS.IN_PROGRESS, actualStartUtc: new Date(), version: { increment: 1 } },
  });
  await recordAudit({
    actorUserId: actor?.id, actorRole: actor?.role,
    action: AUDIT_ACTIONS.INTERVIEW_STARTED, entity: 'Interview', entityId: interviewId,
    summary: 'Interview started',
  });
  return getInterview(interviewId);
}

export async function completeInterview({ interviewId, actor, outcome = INTERVIEW_STATUS.COMPLETED }) {
  const interview = await prisma.interview.findUnique({ where: { id: interviewId }, include: fullInterviewInclude });
  if (!interview) throw notFound('Interview not found');

  await prisma.$transaction(async (tx) => {
    await tx.interview.update({
      where: { id: interviewId },
      data: { status: outcome, actualEndUtc: new Date(), version: { increment: 1 } },
    });
    await tx.interviewRequest.update({
      where: { id: interview.requestId },
      data: { status: outcome === INTERVIEW_STATUS.COMPLETED ? REQUEST_STATUS.COMPLETED : REQUEST_STATUS.PENDING },
    });
    // Resolve any open incidents attached to a finished interview.
    await tx.incident.updateMany({
      where: { interviewId, status: { in: ['OPEN', 'ANALYZING', 'AWAITING_APPROVAL', 'RECOVERING'] } },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
  }, txOptions);

  await recordAudit({
    actorUserId: actor?.id, actorRole: actor?.role,
    action: AUDIT_ACTIONS.INTERVIEW_COMPLETED, entity: 'Interview', entityId: interviewId,
    summary: outcome === INTERVIEW_STATUS.NO_SHOW ? 'Marked as no-show' : 'Interview completed',
  });

  // Ask the panel for feedback - it drives the adaptive next round.
  if (outcome === INTERVIEW_STATUS.COMPLETED) {
    for (const seat of interview.panel) {
      await notify({
        userId: seat.interviewer.userId,
        type: NOTIFICATION_TYPES.FEEDBACK_REQUESTED,
        context: interviewContext(interview, { viewerTimezone: seat.interviewer.user.timezone }),
        channels: ['IN_APP'],
        relatedEntity: 'Interview',
        relatedId: interviewId,
      });
    }
  }

  return getInterview(interviewId);
}

export async function getInterview(interviewId, viewer = {}) {
  const row = await prisma.interview.findUnique({ where: { id: interviewId }, include: fullInterviewInclude });
  if (!row) throw notFound('Interview not found');
  return shapeInterview(row, {
    viewerTimezone: viewer.timezone || row.request.application.candidate.user.timezone,
    viewerRole: viewer.role,
    includeFeedback: viewer.role === 'RECRUITER' || viewer.role === 'ADMIN' || viewer.role === 'INTERVIEWER',
  });
}

export { assertNoConflicts, getSettings, SETTING_KEYS, logger, forbidden };
