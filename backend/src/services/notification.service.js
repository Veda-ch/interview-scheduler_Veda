/**
 * Notification orchestration.
 *
 * Delivery order matters: the in-app row is written FIRST and always succeeds,
 * then email/SMS are attempted as side channels. A provider failure updates the
 * row's status and error, and is reported to the caller - never thrown, because
 * "the confirmation email bounced" must not roll back a confirmed interview.
 *
 * Personalisation is optional AI: when enabled we ask the AI service to draft
 * the copy; the deterministic template is both the fallback and the default.
 */
import prisma from '../lib/prisma.js';
import logger from '../lib/logger.js';
import { getNotificationProvider } from '../providers/notification.provider.js';
import { generateMessage } from './ai.service.js';
import { recordAudit } from './audit.service.js';
import { humanSlot } from '../lib/time.js';
import { AUDIT_ACTIONS, NOTIFICATION_TYPES } from '../../../shared/constants.js';

/** Deterministic templates - identical wording to the AI service's fallbacks. */
const TEMPLATES = {
  [NOTIFICATION_TYPES.INTERVIEW_SCHEDULED]: (c) => ({
    title: `Interview scheduled: ${c.jobTitle}`,
    body:
      `Hi ${c.recipientName},\n\nYour ${c.roundName} interview for ${c.jobTitle} is scheduled for ` +
      `${c.slotLabel}.\n\nInterviewer(s): ${c.interviewers}\nJoin link: ${c.joinUrl || 'to follow'}\n\n` +
      `Please confirm in your dashboard.\n\nTalent Team`,
  }),
  [NOTIFICATION_TYPES.SLOTS_PROPOSED]: (c) => ({
    title: `Choose your interview time: ${c.jobTitle}`,
    body:
      `Hi ${c.recipientName},\n\nWe found ${c.slotCount} time(s) that work for you and the panel for the ` +
      `${c.roundName} interview.\n\nRecommended: ${c.slotLabel}\n\nOpen your dashboard to confirm or pick ` +
      `an alternative.\n\nTalent Team`,
  }),
  [NOTIFICATION_TYPES.INTERVIEW_CONFIRMED]: (c) => ({
    title: `Confirmed: ${c.jobTitle} interview`,
    body: `Hi ${c.recipientName},\n\n${c.candidateName || 'The candidate'} confirmed the ${c.roundName} interview for ${c.slotLabel}.\n\nJoin link: ${c.joinUrl || 'to follow'}\n\nTalent Team`,
  }),
  [NOTIFICATION_TYPES.INTERVIEW_RESCHEDULED]: (c) => ({
    title: `Rescheduled: ${c.jobTitle} interview`,
    body: `Hi ${c.recipientName},\n\nThe ${c.roundName} interview has moved to ${c.slotLabel}.\n\nReason: ${c.reason || 'scheduling change'}\nJoin link: ${c.joinUrl || 'to follow'}\n\nTalent Team`,
  }),
  [NOTIFICATION_TYPES.INTERVIEW_CANCELLED]: (c) => ({
    title: `Cancelled: ${c.jobTitle} interview`,
    body: `Hi ${c.recipientName},\n\nThe ${c.roundName} interview scheduled for ${c.slotLabel} has been cancelled.\n\nReason: ${c.reason || 'not specified'}\n\nTalent Team`,
  }),
  [NOTIFICATION_TYPES.INTERVIEWER_ASSIGNED]: (c) => ({
    title: `You are on a panel: ${c.jobTitle}`,
    body:
      `Hi ${c.recipientName},\n\nYou have been assigned to the ${c.roundName} interview for ${c.jobTitle} ` +
      `at ${c.slotLabel}.\n\nCandidate: ${c.candidateName}\nFocus areas: ${c.focusTopics || 'see the request'}\n` +
      `Join link: ${c.joinUrl || 'to follow'}\n\nPlease accept or decline in the portal.\n\nTalent Team`,
  }),
  [NOTIFICATION_TYPES.INTERVIEWER_REPLACED]: (c) => ({
    title: `Panel change: ${c.jobTitle} interview`,
    body: `Hi ${c.recipientName},\n\nThe panel for the ${c.roundName} interview on ${c.slotLabel} has changed.\n\n${c.reason}\n\nEverything else is unchanged.\n\nTalent Team`,
  }),
  [NOTIFICATION_TYPES.INTERVIEW_REMINDER]: (c) => ({
    title: `Reminder: interview at ${c.slotLabel}`,
    body: `Hi ${c.recipientName},\n\nYour ${c.roundName} interview for ${c.jobTitle} starts at ${c.slotLabel}.\n\nJoin link: ${c.joinUrl || 'see your dashboard'}\n\nTalent Team`,
  }),
  [NOTIFICATION_TYPES.RESCHEDULE_REQUESTED]: (c) => ({
    title: `Reschedule requested: ${c.jobTitle}`,
    body: `Hi ${c.recipientName},\n\n${c.candidateName} requested a new time for the ${c.roundName} interview on ${c.slotLabel}.\n\nReason: ${c.reason || 'not given'}\n\nOpen the Control Tower to generate new slots.\n\nTalent Team`,
  }),
  [NOTIFICATION_TYPES.INCIDENT_RAISED]: (c) => ({
    title: `Action needed: ${c.incidentTitle}`,
    body: `Hi ${c.recipientName},\n\n${c.incidentDescription}\n\nInterview: ${c.jobTitle} - ${c.roundName} at ${c.slotLabel}\n\nThe Control Tower is preparing recovery options.\n\nTalent Team`,
  }),
  [NOTIFICATION_TYPES.RECOVERY_APPLIED]: (c) => ({
    title: `Resolved automatically: ${c.jobTitle} interview`,
    body: `Hi ${c.recipientName},\n\n${c.reason}\n\nCurrent time: ${c.slotLabel}\nJoin link: ${c.joinUrl || 'unchanged'}\n\nNo action is needed from you.\n\nTalent Team`,
  }),
  [NOTIFICATION_TYPES.APPROVAL_REQUIRED]: (c) => ({
    title: `Approval needed: ${c.incidentTitle}`,
    body: `Hi ${c.recipientName},\n\nA recovery plan needs your approval because it is classified ${c.riskLevel} risk.\n\n${c.incidentDescription}\n\nRecommended: ${c.planDescription}\n\nOpen the Control Tower to approve or reject.\n\nTalent Team`,
  }),
  [NOTIFICATION_TYPES.FEEDBACK_REQUESTED]: (c) => ({
    title: `Feedback needed: ${c.candidateName}`,
    body: `Hi ${c.recipientName},\n\nPlease submit feedback for the ${c.roundName} interview with ${c.candidateName} held at ${c.slotLabel}.\n\nYour input decides what the next round focuses on.\n\nTalent Team`,
  }),
};

function renderTemplate(type, context) {
  const fn = TEMPLATES[type];
  if (fn) return fn(context);
  return {
    title: `Update: ${context.jobTitle || 'your interview'}`,
    body: `Hi ${context.recipientName},\n\n${context.reason || 'There is an update on your interview.'}\n\nTalent Team`,
  };
}

/**
 * Send a notification to one user.
 *
 * @param {object} p
 * @param {string} p.userId
 * @param {string} p.type NOTIFICATION_TYPES
 * @param {object} p.context template variables
 * @param {string[]} [p.channels] defaults to ['IN_APP','EMAIL']
 * @param {boolean} [p.personalize] ask the AI service to draft the copy
 * @returns {Promise<{notification: object, delivery: object[]}>}
 */
export async function notify({ userId, type, context = {}, channels = ['IN_APP', 'EMAIL'], personalize = false, relatedEntity, relatedId }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    logger.warn('Notification target does not exist', { userId, type });
    return { notification: null, delivery: [] };
  }

  const ctx = { recipientName: user.name.split(' ')[0], timezone: user.timezone, ...context };
  let rendered = renderTemplate(type, ctx);
  let personalized = false;

  if (personalize) {
    const ai = await generateMessage({
      template_type: type,
      tone: 'warm-professional',
      context: {
        recipient_name: ctx.recipientName,
        job_title: ctx.jobTitle,
        round_name: ctx.roundName,
        slot_label: ctx.slotLabel,
        join_url: ctx.joinUrl,
        interviewers: ctx.interviewers,
        candidate_name: ctx.candidateName,
        timezone: user.timezone,
        reason: ctx.reason,
        focus_topics: ctx.focusTopics,
      },
    });
    if (ai.data?.body && !ai.fallbackUsed) {
      rendered = { title: ai.data.subject || rendered.title, body: ai.data.body };
      personalized = true;
    }
  }

  // 1. In-app row first: this is the durable record.
  const notification = await prisma.notification.create({
    data: {
      userId,
      type,
      channel: 'IN_APP',
      title: rendered.title,
      body: rendered.body,
      status: 'SENT',
      sentAt: new Date(),
      personalized,
      relatedEntity: relatedEntity ?? null,
      relatedId: relatedId ?? null,
    },
  });

  // 2. Side channels, each independently failable.
  const provider = getNotificationProvider();
  const delivery = [];

  if (channels.includes('EMAIL')) {
    try {
      const result = await provider.sendEmail({ to: user.email, subject: rendered.title, body: rendered.body });
      delivery.push({ channel: 'EMAIL', ...result });
      await prisma.notification.create({
        data: {
          userId, type, channel: 'EMAIL', title: rendered.title, body: rendered.body,
          status: result.ok ? 'SENT' : 'FAILED', sentAt: result.ok ? new Date() : null,
          errorMessage: result.ok ? null : result.reason || 'send failed',
          personalized, relatedEntity: relatedEntity ?? null, relatedId: relatedId ?? null,
        },
      });
    } catch (err) {
      logger.error('Email delivery failed', { userId, type, error: err.message });
      delivery.push({ channel: 'EMAIL', ok: false, error: err.message });
      await prisma.notification.create({
        data: {
          userId, type, channel: 'EMAIL', title: rendered.title, body: rendered.body,
          status: 'FAILED', errorMessage: err.message.slice(0, 300),
          relatedEntity: relatedEntity ?? null, relatedId: relatedId ?? null,
        },
      }).catch(() => {});
      await recordAudit({
        actorRole: 'SYSTEM', action: AUDIT_ACTIONS.NOTIFICATION_FAILED, entity: 'Notification',
        entityId: notification.id, summary: `Email to ${user.email} failed: ${err.message.slice(0, 120)}`,
      });
    }
  }

  if (channels.includes('SMS')) {
    if (!user.phone) {
      const reason = 'Recipient has no phone number';
      logger.warn('SMS notification skipped because recipient has no phone number', { userId, type });
      delivery.push({ channel: 'SMS', ok: false, skipped: true, reason });
      await prisma.notification.create({
        data: {
          userId, type, channel: 'SMS', title: rendered.title, body: rendered.body,
          status: 'FAILED', errorMessage: reason,
          relatedEntity: relatedEntity ?? null, relatedId: relatedId ?? null,
        },
      });
    } else {
      try {
        const result = await provider.sendSms({ to: user.phone, body: `${rendered.title}\n${rendered.body.slice(0, 300)}` });
        delivery.push({ channel: 'SMS', ...result });
        await prisma.notification.create({
          data: {
            userId, type, channel: 'SMS', title: rendered.title, body: rendered.body,
            status: result.ok ? 'SENT' : 'FAILED', sentAt: result.ok ? new Date() : null,
            errorMessage: result.ok ? null : result.reason || 'send failed',
            relatedEntity: relatedEntity ?? null, relatedId: relatedId ?? null,
          },
        });
      } catch (err) {
        logger.error('SMS delivery failed', { userId, type, error: err.message });
        delivery.push({ channel: 'SMS', ok: false, error: err.message });
        await prisma.notification.create({
          data: {
            userId, type, channel: 'SMS', title: rendered.title, body: rendered.body,
            status: 'FAILED', errorMessage: err.message.slice(0, 300),
            relatedEntity: relatedEntity ?? null, relatedId: relatedId ?? null,
          },
        });
      }
    }
  }

  await recordAudit({
    actorRole: 'SYSTEM',
    action: AUDIT_ACTIONS.NOTIFICATION_SENT,
    entity: relatedEntity || 'Notification',
    entityId: relatedId || notification.id,
    summary: `${type} sent to ${user.name}`,
    metadata: { type, channels, personalized, delivery: delivery.map((d) => ({ channel: d.channel, ok: d.ok })) },
  });

  return { notification, delivery };
}

/** Fan-out helper: notify many users with per-recipient context. */
export async function notifyMany(targets) {
  const results = await Promise.allSettled(targets.map((t) => notify(t)));
  return results.map((r, i) => ({
    userId: targets[i].userId,
    ok: r.status === 'fulfilled',
    error: r.status === 'rejected' ? r.reason?.message : undefined,
  }));
}

/** Build the context object shared by every interview-related notification. */
export function interviewContext(interview, { viewerTimezone = 'UTC', extra = {} } = {}) {
  const app = interview.request?.application;
  return {
    jobTitle: app?.job?.title ?? 'the role',
    roundName: interview.request?.roundName ?? 'interview',
    slotLabel: humanSlot(interview.startUtc, interview.endUtc, viewerTimezone),
    joinUrl: interview.meeting?.joinUrl ?? '',
    candidateName: app?.candidate?.user?.name ?? 'the candidate',
    interviewers: (interview.panel || []).map((p) => p.interviewer?.user?.name).filter(Boolean).join(', '),
    focusTopics: (interview.request?.focusTopicsJson ? JSON.parse(interview.request.focusTopicsJson) : []).join(', '),
    ...extra,
  };
}

export async function listNotifications(userId, { unreadOnly = false, take = 50 } = {}) {
  return prisma.notification.findMany({
    where: { userId, channel: 'IN_APP', ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(take, 200),
  });
}

export async function markRead(userId, ids) {
  return prisma.notification.updateMany({
    where: { userId, id: { in: ids } },
    data: { readAt: new Date(), status: 'READ' },
  });
}

export async function markAllRead(userId) {
  return prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date(), status: 'READ' },
  });
}

export { NOTIFICATION_TYPES };
