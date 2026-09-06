/**
 * AUTOMATIC SCHEDULING
 *
 * The candidate submitting their times is the trigger for the whole pipeline.
 * Nobody presses "book" - the system resolves the round itself and only falls
 * back to a human when it genuinely cannot.
 *
 *   1. MATCH      candidate slots x interviewer availability, ranked by how well
 *                 the interviewer's skills cover the job. Top pairing is booked.
 *
 *   2. OFFER      nobody declared themselves free for any of the candidate's
 *                 times. The best-ranked interviewer is *asked* to take one of
 *                 them. The candidate's slots are held meanwhile, and the round
 *                 sits in WAITING. No answer in 12h expires the offer and passes
 *                 it to the second-ranked interviewer.
 *
 *   3. RE-OFFER   both declined (or ran out of time). The candidate is told their
 *                 times did not work and picks from the top interviewer's own
 *                 declared availability instead. That always terminates: those
 *                 windows are already consent, so no further approval is needed.
 *
 * Everything that actually writes a booking goes through confirmProposal(), so
 * the double-booking guard, buffers, meeting/calendar creation, notifications
 * and audit trail are identical to a manually booked interview.
 */
import prisma from '../lib/prisma.js';
import logger from '../lib/logger.js';
import { notFound, badRequest, conflict } from '../lib/errors.js';
import { parseArray, stringifyJson } from '../lib/json.js';
import { humanSlot, addMinutes, enumerateSlots, DateTime } from '../lib/time.js';
import { recordAudit } from './audit.service.js';
import { notify } from './notification.service.js';
import { rankInterviewers } from './matching.service.js';
import { generateProposals } from './scheduling.service.js';
import { confirmProposal, cancelInterview, rescheduleInterview } from './orchestration.service.js';
import { interviewerFreeWindows } from './availability.service.js';
import { getSettings } from './settings.service.js';
import {
  REQUEST_STATUS,
  OFFER_STATUS,
  OFFER_RESPONSE_HOURS,
  OFFER_MAX_RANK,
  AUDIT_ACTIONS,
  NOTIFICATION_TYPES,
  ACTIVE_INTERVIEW_STATUSES,
  SETTING_KEYS,
} from '../../../shared/constants.js';

const SYSTEM = { id: null, role: 'SYSTEM' };

const requestInclude = {
  application: {
    include: {
      job: true,
      candidate: { include: { user: true, skills: { include: { skill: true } } } },
    },
  },
};

async function loadRequest(requestId) {
  const request = await prisma.interviewRequest.findUnique({
    where: { id: requestId },
    include: requestInclude,
  });
  if (!request) throw notFound('Interview request not found');
  return request;
}

// ---------------------------------------------------------------------------
// Holds - the candidate's offered times are reserved while an offer is open
// ---------------------------------------------------------------------------

async function holdCandidateSlots(request, slots) {
  const userId = request.application.candidate.userId;
  for (const slot of slots) {
    // A hold is advisory: it stops another round taking the same time while an
    // interviewer is deciding. It never blocks the interviewer, who has not
    // agreed to anything yet.
    await prisma.booking
      .create({
        data: {
          userId,
          startUtc: new Date(slot.startUtc),
          endUtc: new Date(slot.endUtc),
          kind: 'HOLD',
        },
      })
      .catch(() => {}); // a duplicate hold for the same instant is harmless
  }
}

async function releaseCandidateHolds(request) {
  await prisma.booking.deleteMany({
    where: { userId: request.application.candidate.userId, kind: 'HOLD' },
  });
}

// ---------------------------------------------------------------------------
// 1. MATCH - the happy path
// ---------------------------------------------------------------------------

/**
 * Resolve a round end to end. Called the moment the candidate submits times.
 * @returns {Promise<{outcome:string, interview?:object, offer?:object, request:object}>}
 */
export async function runAutoSchedule(requestId, { actor = SYSTEM } = {}) {
  const request = await loadRequest(requestId);

  if (request.status === REQUEST_STATUS.SCHEDULED) {
    throw conflict('This round is already scheduled.', 'ALREADY_SCHEDULED');
  }

  let generated = null;
  try {
    generated = await generateProposals(requestId, { persist: true });
  } catch (err) {
    if (err.code !== 'NO_FEASIBLE_SLOT') throw err;
    // No overlap between the candidate's times and anyone's declared
    // availability - go and ask someone directly.
    logger.info('No feasible slot; opening an offer', { requestId });
    return openOffer(request, 1);
  }

  const top = generated.proposals?.[0];
  if (!top) return openOffer(request, 1);

  const interview = await confirmProposal({
    proposalId: top.id,
    actor,
    autoConfirmCandidate: true,
    reason: 'Automatically booked from the candidate’s submitted times',
  });

  await recordAudit({
    actorUserId: actor?.id ?? null,
    actorRole: 'SYSTEM',
    action: AUDIT_ACTIONS.AUTO_BOOKED,
    entity: 'InterviewRequest',
    entityId: requestId,
    summary: `Auto-booked ${request.roundName} with ${top.interviewers.map((i) => i.name).join(', ')} (match ${Math.round(top.interviewers[0]?.matchScore ?? 0)}%)`,
    metadata: {
      interviewId: interview.id,
      slot: top.localLabels?.candidate,
      engine: generated.engineUsed,
      ranking: (generated.matching?.ranked || []).map((r) => ({ name: r.name, score: Math.round(r.matchScore) })),
    },
  });

  return { outcome: 'BOOKED', interview, request: await loadRequest(requestId) };
}

// ---------------------------------------------------------------------------
// 2. OFFER - ask a specific interviewer to take one of the candidate's times
// ---------------------------------------------------------------------------

/** Slots the interviewer has no existing booking against. */
async function conflictFreeSlots(interviewer, slots, bufferMinutes) {
  const out = [];
  for (const slot of slots) {
    const start = new Date(slot.startUtc);
    const end = new Date(slot.endUtc);
    const clash = await prisma.booking.findFirst({
      where: {
        userId: interviewer.userId,
        startUtc: { lt: addMinutes(end, bufferMinutes) },
        endUtc: { gt: addMinutes(start, -bufferMinutes) },
      },
    });
    if (!clash) out.push({ startUtc: start.toISOString(), endUtc: end.toISOString() });
  }
  return out;
}

async function openOffer(request, rank) {
  const slots = parseArray(request.candidateSlotsJson);
  if (!slots.length) {
    return failRequest(request, 'The candidate has not submitted any times yet.');
  }

  // Rank on skill alone: we are about to ask someone to take a time they never
  // declared, so having declared nothing must not disqualify them.
  const { ranked } = await rankInterviewers({
    request,
    rangeStart: new Date(request.earliestUtc),
    rangeEnd: new Date(request.latestUtc),
    ignoreAvailability: true,
    limit: OFFER_MAX_RANK + 3,
  });

  const candidateIsFor = ranked[rank - 1];
  if (!candidateIsFor) {
    // Nobody left at this rank - hand the choice back to the candidate.
    return enterFallbackB(request, ranked[0] ?? null);
  }

  const interviewer = await prisma.interviewerProfile.findUnique({
    where: { id: candidateIsFor.interviewerId },
    include: { user: true },
  });

  const open = await conflictFreeSlots(interviewer, slots, request.bufferMinutes);
  if (!open.length) {
    // Every proposed time collides with something already on their calendar.
    logger.info('Interviewer busy at every offered slot; escalating', {
      requestId: request.id,
      interviewer: interviewer.user.name,
    });
    return escalate(request, rank);
  }

  await releaseCandidateHolds(request);
  await holdCandidateSlots(request, open);

  const expiresAt = addMinutes(new Date(), OFFER_RESPONSE_HOURS * 60);
  const offer = await prisma.slotOffer.create({
    data: {
      requestId: request.id,
      interviewerId: interviewer.id,
      rank,
      matchScore: candidateIsFor.matchScore ?? 0,
      slotsJson: stringifyJson(open),
      status: OFFER_STATUS.PENDING,
      expiresAt,
    },
  });

  await prisma.interviewRequest.update({
    where: { id: request.id },
    data: { status: REQUEST_STATUS.WAITING, failureReason: null },
  });

  const zone = interviewer.user.timezone || 'UTC';
  await notify({
    userId: interviewer.userId,
    type: NOTIFICATION_TYPES.SLOT_OFFER_RECEIVED,
    context: {
      roundName: request.roundName,
      candidateName: request.application.candidate.user.name,
      jobTitle: request.application.job.title,
      slotCount: open.length,
      firstSlot: humanSlot(open[0].startUtc, open[0].endUtc, zone),
      respondBy: DateTime.fromJSDate(expiresAt).setZone(zone).toFormat('ccc dd LLL, HH:mm'),
    },
    relatedEntity: 'SlotOffer',
    relatedId: offer.id,
  });

  await notify({
    userId: request.application.candidate.userId,
    type: NOTIFICATION_TYPES.SLOTS_PROPOSED,
    context: {
      roundName: request.roundName,
      message: `Your times are with ${interviewer.user.name} for confirmation.`,
    },
    relatedEntity: 'InterviewRequest',
    relatedId: request.id,
  });

  await recordAudit({
    actorRole: 'SYSTEM',
    action: AUDIT_ACTIONS.OFFER_SENT,
    entity: 'InterviewRequest',
    entityId: request.id,
    summary: `Offered ${open.length} candidate slot(s) to ${interviewer.user.name} (rank ${rank}, match ${Math.round(candidateIsFor.matchScore ?? 0)}%)`,
    metadata: { offerId: offer.id, rank, expiresAt },
  });

  return { outcome: 'OFFER_SENT', offer, request: await loadRequest(request.id) };
}

/** Move on after a decline or an expiry. */
async function escalate(request, fromRank) {
  if (fromRank < OFFER_MAX_RANK) return openOffer(request, fromRank + 1);

  const { ranked } = await rankInterviewers({
    request,
    rangeStart: new Date(request.earliestUtc),
    rangeEnd: new Date(request.latestUtc),
    ignoreAvailability: true,
    limit: 5,
  });
  return enterFallbackB(request, ranked[0] ?? null);
}

// ---------------------------------------------------------------------------
// 3. RE-OFFER - the candidate picks from the interviewer's own free slots
// ---------------------------------------------------------------------------

async function enterFallbackB(request, topRanked) {
  await releaseCandidateHolds(request);

  if (!topRanked) {
    return failRequest(request, 'No interviewer is qualified for this round.');
  }

  await prisma.interviewRequest.update({
    where: { id: request.id },
    data: { status: REQUEST_STATUS.SLOTS_OFFERED, failureReason: null },
  });

  await notify({
    userId: request.application.candidate.userId,
    type: NOTIFICATION_TYPES.SLOTS_UNAVAILABLE,
    context: {
      roundName: request.roundName,
      jobTitle: request.application.job.title,
      message: 'None of your requested times were available. Please choose from the times we can offer.',
    },
    relatedEntity: 'InterviewRequest',
    relatedId: request.id,
  });

  await recordAudit({
    actorRole: 'SYSTEM',
    action: AUDIT_ACTIONS.SLOTS_GENERATED,
    entity: 'InterviewRequest',
    entityId: request.id,
    summary: `Candidate times exhausted; offering ${topRanked.name}'s own availability instead`,
    metadata: { interviewerId: topRanked.interviewerId },
  });

  return { outcome: 'SLOTS_OFFERED', request: await loadRequest(request.id) };
}

async function failRequest(request, reason) {
  await releaseCandidateHolds(request);
  await prisma.interviewRequest.update({
    where: { id: request.id },
    data: { status: REQUEST_STATUS.FAILED, failureReason: reason },
  });
  return { outcome: 'FAILED', reason, request: await loadRequest(request.id) };
}

/**
 * The times the candidate can pick from once their own were exhausted, and the
 * same list used when rescheduling. Always the *declared* availability of one
 * interviewer, so a pick books immediately without another approval round.
 */
export async function offeredSlotsFor(requestId, { interviewerId = null } = {}) {
  const request = await loadRequest(requestId);
  const settings = await getSettings();

  let target = interviewerId;
  if (!target) {
    const { ranked } = await rankInterviewers({
      request,
      rangeStart: new Date(request.earliestUtc),
      rangeEnd: new Date(request.latestUtc),
      ignoreAvailability: true,
      limit: 1,
    });
    target = ranked[0]?.interviewerId ?? null;
  }
  if (!target) return { interviewer: null, slots: [] };

  const interviewer = await prisma.interviewerProfile.findUnique({
    where: { id: target },
    include: { user: true },
  });

  const rangeStart = new Date(Math.max(+new Date(request.earliestUtc), Date.now()));
  const rangeEnd = new Date(request.latestUtc);
  const free = await interviewerFreeWindows(interviewer, rangeStart, rangeEnd, request.bufferMinutes);

  const granularity = settings[SETTING_KEYS.SLOT_GRANULARITY_MINUTES] || 30;
  const candidateZone = request.application.candidate.user.timezone || 'UTC';

  const slots = enumerateSlots({
    windows: free.free,
    durationMinutes: request.durationMinutes,
    granularityMinutes: granularity,
    zone: candidateZone,
    limit: 40,
  }).map((s) => ({
    startUtc: s.start.toISOString(),
    endUtc: s.end.toISOString(),
    label: humanSlot(s.start, s.end, candidateZone),
  }));

  return {
    interviewer: { id: interviewer.id, name: interviewer.user.name, title: interviewer.title },
    slots,
  };
}

/** Book one of those offered times. Used by fallback B and by reschedule. */
export async function bookOfferedSlot({ requestId, interviewerId, startUtc, endUtc, actor, reason }) {
  const request = await loadRequest(requestId);
  const start = new Date(startUtc);
  const end = new Date(endUtc);
  if (!(end > start)) throw badRequest('The slot must end after it starts');

  const proposal = await prisma.slotProposal.create({
    data: {
      requestId: request.id,
      rank: 1,
      startUtc: start,
      endUtc: end,
      score: 100,
      riskScore: 0,
      interviewerIdsCsv: interviewerId,
      matchScoresJson: stringifyJson({}),
      reasonsJson: stringifyJson(['Chosen by the candidate from the interviewer’s available times']),
      breakdownJson: stringifyJson({}),
      engineUsed: 'CANDIDATE_PICK',
      expiresAt: addMinutes(new Date(), 60),
    },
  });

  await releaseCandidateHolds(request);

  return confirmProposal({
    proposalId: proposal.id,
    actor,
    autoConfirmCandidate: true,
    reason: reason || 'Chosen by the candidate from the offered times',
  });
}

// ---------------------------------------------------------------------------
// Interviewer responds to an offer
// ---------------------------------------------------------------------------

export async function respondToOffer({ offerId, interviewerId, action, startUtc, endUtc, reason, actor }) {
  const offer = await prisma.slotOffer.findUnique({
    where: { id: offerId },
    include: { request: { include: requestInclude }, interviewer: { include: { user: true } } },
  });
  if (!offer) throw notFound('Offer not found');
  if (offer.interviewerId !== interviewerId) throw badRequest('This offer is not addressed to you');
  if (offer.status !== OFFER_STATUS.PENDING) {
    throw conflict(`This offer is already ${offer.status.toLowerCase()}.`, 'OFFER_CLOSED');
  }
  if (offer.expiresAt < new Date()) {
    throw conflict('This offer has expired and has moved on.', 'OFFER_EXPIRED');
  }

  const request = offer.request;

  if (action === 'DECLINE') {
    await prisma.slotOffer.update({
      where: { id: offer.id },
      data: { status: OFFER_STATUS.DECLINED, declineReason: reason ?? null, respondedAt: new Date() },
    });
    await recordAudit({
      actorUserId: actor?.id ?? null,
      actorRole: actor?.role ?? 'INTERVIEWER',
      action: AUDIT_ACTIONS.OFFER_DECLINED,
      entity: 'InterviewRequest',
      entityId: request.id,
      summary: `${offer.interviewer.user.name} declined the offered times${reason ? `: "${String(reason).slice(0, 120)}"` : ''}`,
      metadata: { offerId: offer.id, rank: offer.rank },
    });
    await releaseCandidateHolds(request);
    return escalate(request, offer.rank);
  }

  // --- ACCEPT
  const offered = parseArray(offer.slotsJson);
  const chosen = offered.find(
    (s) => +new Date(s.startUtc) === +new Date(startUtc) && +new Date(s.endUtc) === +new Date(endUtc)
  );
  if (!chosen) throw badRequest('Pick one of the times you were offered');

  await releaseCandidateHolds(request);

  const proposal = await prisma.slotProposal.create({
    data: {
      requestId: request.id,
      rank: 1,
      startUtc: new Date(chosen.startUtc),
      endUtc: new Date(chosen.endUtc),
      score: Math.round(offer.matchScore),
      riskScore: 0,
      interviewerIdsCsv: offer.interviewerId,
      matchScoresJson: stringifyJson({ [offer.interviewerId]: offer.matchScore }),
      reasonsJson: stringifyJson([
        `${offer.interviewer.user.name} accepted a time the candidate proposed`,
        `Skill match ${Math.round(offer.matchScore)}%`,
      ]),
      breakdownJson: stringifyJson({}),
      engineUsed: 'INTERVIEWER_ACCEPTED',
      expiresAt: addMinutes(new Date(), 60),
    },
  });

  const interview = await confirmProposal({
    proposalId: proposal.id,
    actor,
    autoConfirmCandidate: true,
    reason: 'Interviewer accepted one of the candidate’s proposed times',
  });

  await prisma.slotOffer.update({
    where: { id: offer.id },
    data: {
      status: OFFER_STATUS.ACCEPTED,
      chosenStartUtc: new Date(chosen.startUtc),
      chosenEndUtc: new Date(chosen.endUtc),
      respondedAt: new Date(),
    },
  });

  await recordAudit({
    actorUserId: actor?.id ?? null,
    actorRole: actor?.role ?? 'INTERVIEWER',
    action: AUDIT_ACTIONS.OFFER_ACCEPTED,
    entity: 'InterviewRequest',
    entityId: request.id,
    summary: `${offer.interviewer.user.name} accepted ${humanSlot(chosen.startUtc, chosen.endUtc, offer.interviewer.user.timezone)}`,
    metadata: { offerId: offer.id, interviewId: interview.id },
  });

  return { outcome: 'BOOKED', interview, request: await loadRequest(request.id) };
}

/** Offers nobody answered in time. Driven by the background monitor. */
export async function expireStaleOffers() {
  const stale = await prisma.slotOffer.findMany({
    where: { status: OFFER_STATUS.PENDING, expiresAt: { lt: new Date() } },
    include: { request: { include: requestInclude }, interviewer: { include: { user: true } } },
  });

  const results = [];
  for (const offer of stale) {
    await prisma.slotOffer.update({
      where: { id: offer.id },
      data: { status: OFFER_STATUS.EXPIRED, respondedAt: new Date() },
    });
    await recordAudit({
      actorRole: 'SYSTEM',
      action: AUDIT_ACTIONS.OFFER_EXPIRED,
      entity: 'InterviewRequest',
      entityId: offer.requestId,
      summary: `${offer.interviewer.user.name} did not respond within ${OFFER_RESPONSE_HOURS}h; offer passed on`,
      metadata: { offerId: offer.id, rank: offer.rank },
    });

    // A round that has since been scheduled or cancelled needs no escalation.
    if (![REQUEST_STATUS.WAITING].includes(offer.request.status)) continue;

    try {
      results.push(await escalate(offer.request, offer.rank));
    } catch (err) {
      logger.error('Offer escalation failed', { offerId: offer.id, error: err.message });
    }
  }
  return { expired: stale.length, escalated: results.length };
}

// ---------------------------------------------------------------------------
// Candidate-initiated cancel
// ---------------------------------------------------------------------------

/** Cancel kills the whole round, not just the sitting. */
export async function candidateCancel({ interviewId, reason, actor }) {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: { request: true },
  });
  if (!interview) throw notFound('Interview not found');
  if (!ACTIVE_INTERVIEW_STATUSES.includes(interview.status)) {
    throw conflict(`This interview is already ${interview.status.toLowerCase()}.`, 'INVALID_STATE');
  }

  await cancelInterview({ interviewId, reason, actor, notifyParticipants: true });

  await prisma.interviewRequest.update({
    where: { id: interview.requestId },
    data: { status: REQUEST_STATUS.CANCELLED, failureReason: `Cancelled by the candidate: ${reason}` },
  });
  await prisma.slotOffer.updateMany({
    where: { requestId: interview.requestId, status: OFFER_STATUS.PENDING },
    data: { status: OFFER_STATUS.EXPIRED },
  });

  await recordAudit({
    actorUserId: actor?.id ?? null,
    actorRole: actor?.role ?? 'CANDIDATE',
    action: AUDIT_ACTIONS.CANDIDATE_CANCELLED,
    entity: 'InterviewRequest',
    entityId: interview.requestId,
    summary: `Candidate cancelled the round: "${String(reason).slice(0, 120)}"`,
    metadata: { interviewId },
  });

  return { cancelled: true, requestId: interview.requestId };
}

/**
 * Move a booked interview to another of the same interviewer's free times.
 *
 * Deliberately does not re-run matching: the panel is already settled, so the
 * candidate is only choosing a new time from the person they were matched with.
 */
export async function candidateReschedule({ interviewId, startUtc, endUtc, actor }) {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: { panel: true },
  });
  if (!interview) throw notFound('Interview not found');
  if (!ACTIVE_INTERVIEW_STATUSES.includes(interview.status)) {
    throw conflict(`This interview is ${interview.status.toLowerCase()} and cannot be moved.`, 'INVALID_STATE');
  }

  const start = new Date(startUtc);
  const end = new Date(endUtc);
  if (!(end > start)) throw badRequest('The new time must end after it starts');

  const moved = await rescheduleInterview({
    interviewId,
    startUtc: start,
    endUtc: end,
    reason: 'Moved by the candidate to another of the interviewer’s available times',
    actor,
  });

  await recordAudit({
    actorUserId: actor?.id ?? null,
    actorRole: actor?.role ?? 'CANDIDATE',
    action: AUDIT_ACTIONS.INTERVIEW_RESCHEDULED ?? 'INTERVIEW_RESCHEDULED',
    entity: 'Interview',
    entityId: interviewId,
    summary: `Candidate moved the interview to ${humanSlot(start, end, 'UTC')}`,
    metadata: { from: interview.startUtc, to: start },
  });

  return moved;
}

/** Shape a SlotOffer for the API. */
export function shapeOffer(offer, viewerZone = 'UTC') {
  if (!offer) return null;
  return {
    id: offer.id,
    requestId: offer.requestId,
    rank: offer.rank,
    matchScore: offer.matchScore,
    status: offer.status,
    expiresAt: offer.expiresAt,
    hoursLeft: Math.max(0, Math.round(((+offer.expiresAt - Date.now()) / 3600000) * 10) / 10),
    slots: parseArray(offer.slotsJson).map((s) => ({
      startUtc: s.startUtc,
      endUtc: s.endUtc,
      label: humanSlot(s.startUtc, s.endUtc, viewerZone),
    })),
    chosenStartUtc: offer.chosenStartUtc,
    declineReason: offer.declineReason,
    round: offer.request
      ? {
          requestId: offer.request.id,
          name: offer.request.roundName,
          type: offer.request.interviewType,
          durationMinutes: offer.request.durationMinutes,
          candidateName: offer.request.application?.candidate?.user?.name,
          jobTitle: offer.request.application?.job?.title,
        }
      : null,
    createdAt: offer.createdAt,
  };
}
