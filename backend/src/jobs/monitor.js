/**
 * Control Tower background monitor.
 *
 * A polling interval job (NOT real-time streaming - we are precise about that:
 * detection latency is bounded by MONITOR_INTERVAL_MS, default 60s). Each tick
 * runs a set of independent detectors; one failing detector never stops the
 * others, and every incident it raises is de-duplicated by a stable key so a
 * long-running condition produces one incident, not one per minute.
 */
import prisma from '../lib/prisma.js';
import logger from '../lib/logger.js';
import config from '../config/env.js';
import { raiseIncident } from '../services/controlTower.service.js';
import { getSettings } from '../services/settings.service.js';
import { notify, interviewContext } from '../services/notification.service.js';
import { computeWorkloadBulk } from '../services/interviewer.service.js';
import { fullInterviewInclude } from '../services/interview.shape.js';
import { addMinutes } from '../lib/time.js';
import {
  INCIDENT_TYPES,
  SEVERITY,
  INTERVIEW_STATUS,
  ACTIVE_INTERVIEW_STATUSES,
  PANEL_RESPONSE,
  NOTIFICATION_TYPES,
  SETTING_KEYS,
} from '../../../shared/constants.js';

let timer = null;
let running = false;
const stats = { ticks: 0, lastTickAt: null, lastDurationMs: 0, incidentsRaised: 0, errors: 0 };

/** Detector: an interview that should have ended but is still in progress. */
async function detectOverruns(now, settings) {
  const grace = settings[SETTING_KEYS.OVERRUN_GRACE_MINUTES] ?? 10;
  const cutoff = addMinutes(now, -grace);

  const overrunning = await prisma.interview.findMany({
    where: { status: INTERVIEW_STATUS.IN_PROGRESS, endUtc: { lt: cutoff } },
    include: fullInterviewInclude,
  });

  for (const iv of overrunning) {
    const overrunMinutes = Math.round((now - iv.endUtc) / 60000);

    // What is the panel due to do next? That is the thing at risk.
    const panelUserIds = iv.panel.map((p) => p.interviewer.userId);
    const nextBooking = await prisma.booking.findFirst({
      where: {
        userId: { in: panelUserIds },
        interviewId: { not: iv.id },
        startUtc: { gte: iv.endUtc, lte: addMinutes(now, 180) },
      },
      orderBy: { startUtc: 'asc' },
      include: { interview: { select: { id: true, startUtc: true, endUtc: true } } },
    });

    await raiseIncident({
      interviewId: iv.id,
      type: INCIDENT_TYPES.INTERVIEW_OVERRUN,
      // Bucket in 15-minute steps so a worsening overrun can escalate once,
      // instead of raising a new incident every tick.
      bucket: String(Math.floor(overrunMinutes / 15)),
      severity: nextBooking ? SEVERITY.HIGH : SEVERITY.MEDIUM,
      title: `Interview running ${overrunMinutes} minutes over`,
      description:
        `Scheduled ${iv.startUtc.toISOString()} - ${iv.endUtc.toISOString()}, still in progress at ${now.toISOString()}.` +
        (nextBooking ? ' A panellist has another commitment coming up.' : ' No immediate downstream commitment detected.'),
      context: { overrunMinutes, nextInterview: nextBooking?.interview ?? null },
    });
    stats.incidentsRaised += 1;
  }
}

/** Detector: the interview started but nobody marked it in progress / candidate never showed. */
async function detectNoShows(now) {
  const graceMinutes = 15;
  const stale = await prisma.interview.findMany({
    where: {
      status: { in: [INTERVIEW_STATUS.SCHEDULED, INTERVIEW_STATUS.CONFIRMED] },
      startUtc: { lt: addMinutes(now, -graceMinutes) },
      endUtc: { gt: addMinutes(now, -24 * 60) },
    },
    include: fullInterviewInclude,
  });

  for (const iv of stale) {
    // Only treat it as a no-show once we are past the halfway point.
    const halfway = addMinutes(iv.startUtc, (iv.endUtc - iv.startUtc) / 120000);
    if (now < halfway) continue;

    await raiseIncident({
      interviewId: iv.id,
      type: INCIDENT_TYPES.CANDIDATE_NO_SHOW,
      severity: SEVERITY.HIGH,
      title: 'Interview did not start',
      description: `The interview was scheduled for ${iv.startUtc.toISOString()} but was never marked as started. Treating as a probable no-show.`,
    });
    stats.incidentsRaised += 1;
  }
}

/** Detector: interviews starting soon that are still unconfirmed. */
async function detectUnconfirmedImminent(now) {
  const horizon = addMinutes(now, 24 * 60);
  const rows = await prisma.interview.findMany({
    where: {
      status: { in: ACTIVE_INTERVIEW_STATUSES },
      startUtc: { gte: now, lte: horizon },
      OR: [{ candidateResponse: 'PENDING' }, { panel: { some: { responseStatus: PANEL_RESPONSE.PENDING } } }],
    },
    include: fullInterviewInclude,
  });

  for (const iv of rows) {
    const hours = (iv.startUtc - now) / 3600000;
    if (hours > 12) continue; // only escalate inside 12h

    const pending = [
      ...(iv.candidateResponse === 'PENDING' ? ['candidate'] : []),
      ...iv.panel.filter((p) => p.responseStatus === PANEL_RESPONSE.PENDING).map((p) => p.interviewer.user.name),
    ];

    await raiseIncident({
      interviewId: iv.id,
      type: INCIDENT_TYPES.UNCONFIRMED_IMMINENT,
      bucket: hours < 3 ? 'urgent' : 'soon',
      severity: hours < 3 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
      title: `Unconfirmed interview starting in ${Math.round(hours)}h`,
      description: `Still awaiting confirmation from: ${pending.join(', ')}.`,
    });
    stats.incidentsRaised += 1;
  }
}

/** Detector: integration records left in a failed state. */
async function detectIntegrationFailures() {
  const failedCalendar = await prisma.calendarEventRecord.findMany({
    where: { status: 'SYNC_FAILED', interview: { status: { in: ACTIVE_INTERVIEW_STATUSES } } },
    include: { interview: true },
    take: 20,
  });
  for (const rec of failedCalendar) {
    await raiseIncident({
      interviewId: rec.interviewId,
      type: INCIDENT_TYPES.CALENDAR_SYNC_FAILURE,
      severity: SEVERITY.LOW,
      title: 'Calendar event out of sync',
      description: `The calendar provider reported: ${rec.syncError || 'unknown error'}.`,
    });
    stats.incidentsRaised += 1;
  }

  const failedMeetings = await prisma.meeting.findMany({
    where: { status: 'FAILED', interview: { status: { in: ACTIVE_INTERVIEW_STATUSES } } },
    take: 20,
  });
  for (const m of failedMeetings) {
    await raiseIncident({
      interviewId: m.interviewId,
      type: INCIDENT_TYPES.MEETING_LINK_FAILURE,
      severity: SEVERITY.MEDIUM,
      title: 'Meeting link unavailable',
      description: `The meeting provider reported: ${m.lastError || 'unknown error'}.`,
    });
    stats.incidentsRaised += 1;
  }
}

/** Detector: an interviewer past their own declared weekly ceiling. */
async function detectOverload() {
  const active = await prisma.interviewerProfile.findMany({ where: { isActive: true }, select: { id: true } });
  if (!active.length) return;

  const loads = await computeWorkloadBulk(active.map((a) => a.id));
  for (const [interviewerId, load] of loads) {
    if (load.utilization < 1 && !load.atDailyLimit) continue;

    const seat = await prisma.interviewPanelMember.findFirst({
      where: {
        interviewerId,
        interview: { status: { in: ACTIVE_INTERVIEW_STATUSES }, startUtc: { gte: new Date() } },
      },
      orderBy: { interview: { startUtc: 'asc' } },
      include: { interviewer: { include: { user: true } } },
    });

    await raiseIncident({
      interviewId: seat?.interviewId ?? null,
      type: INCIDENT_TYPES.INTERVIEWER_OVERLOAD,
      bucket: new Date().toISOString().slice(0, 10), // one per interviewer per day
      severity: SEVERITY.MEDIUM,
      title: `${seat?.interviewer.user.name || 'An interviewer'} is at capacity`,
      description:
        `${load.upcomingCount}/${load.maxPerWeek} interviews this week` +
        (load.atDailyLimit ? `, and ${load.busiestDayCount}/${load.maxPerDay} on their busiest day.` : '.') +
        ' Consider rebalancing upcoming rounds.',
      context: { interviewerId, load },
    });
    stats.incidentsRaised += 1;
  }
}

/** Not an incident: proactive reminders for interviews starting soon. */
async function sendReminders(now) {
  const from = addMinutes(now, 55);
  const to = addMinutes(now, 65);

  const soon = await prisma.interview.findMany({
    where: { status: { in: ACTIVE_INTERVIEW_STATUSES }, startUtc: { gte: from, lte: to } },
    include: fullInterviewInclude,
  });

  for (const iv of soon) {
    const already = await prisma.notification.findFirst({
      where: { relatedId: iv.id, type: NOTIFICATION_TYPES.INTERVIEW_REMINDER, channel: 'IN_APP' },
    });
    if (already) continue;

    const targets = [
      { userId: iv.request.application.candidate.userId, zone: iv.request.application.candidate.user.timezone },
      ...iv.panel.map((p) => ({ userId: p.interviewer.userId, zone: p.interviewer.user.timezone })),
    ];
    for (const t of targets) {
      await notify({
        userId: t.userId,
        type: NOTIFICATION_TYPES.INTERVIEW_REMINDER,
        context: interviewContext(iv, { viewerTimezone: t.zone }),
        relatedEntity: 'Interview',
        relatedId: iv.id,
      });
    }
  }
}

/** Housekeeping: expire stale proposals so they cannot be confirmed later. */
async function expireProposals(now) {
  const { count } = await prisma.slotProposal.updateMany({
    where: { status: 'OPEN', OR: [{ expiresAt: { lt: now } }, { startUtc: { lt: now } }] },
    data: { status: 'EXPIRED' },
  });
  if (count) logger.debug(`Expired ${count} stale slot proposal(s)`);
}

const DETECTORS = [
  ['overruns', detectOverruns],
  ['no-shows', detectNoShows],
  ['unconfirmed', detectUnconfirmedImminent],
  ['integrations', detectIntegrationFailures],
  ['overload', detectOverload],
  ['reminders', sendReminders],
  ['housekeeping', expireProposals],
];

/** Run one monitoring pass. Exported so tests can drive it deterministically. */
export async function runMonitorTick({ now = new Date() } = {}) {
  if (running) {
    logger.debug('Monitor tick skipped (previous tick still running)');
    return stats;
  }
  running = true;
  const started = Date.now();

  try {
    const settings = await getSettings();
    if (settings[SETTING_KEYS.MONITOR_ENABLED] === false) {
      logger.debug('Monitor disabled by system setting');
      return stats;
    }

    for (const [name, fn] of DETECTORS) {
      try {
        await fn(now, settings);
      } catch (err) {
        stats.errors += 1;
        logger.error(`Monitor detector "${name}" failed`, { error: err.message });
      }
    }
  } finally {
    running = false;
    stats.ticks += 1;
    stats.lastTickAt = new Date();
    stats.lastDurationMs = Date.now() - started;
  }
  return stats;
}

export function startMonitor() {
  if (timer) return;
  logger.info(`Control Tower monitor started (polling every ${config.monitor.intervalMs / 1000}s)`);
  // First pass shortly after boot so the dashboard is populated immediately.
  setTimeout(() => runMonitorTick().catch(() => {}), 5_000).unref();
  timer = setInterval(() => runMonitorTick().catch(() => {}), config.monitor.intervalMs);
  timer.unref?.();
}

export function stopMonitor() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info('Control Tower monitor stopped');
  }
}

export const monitorStats = () => ({
  ...stats,
  enabled: Boolean(timer),
  intervalMs: config.monitor.intervalMs,
  detectionLatencyNote: 'Polling-based: detection latency is bounded by the interval, not instantaneous.',
});
