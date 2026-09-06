/**
 * Availability resolution.
 *
 * A person's *effective* free time for a range is computed, not stored:
 *
 *   effective = ( declared AVAILABLE windows  OR  their recurring working hours )
 *               MINUS declared UNAVAILABLE windows
 *               MINUS existing bookings expanded by the buffer
 *
 * Everything is UTC by the time it reaches here; the timezone only decides how
 * working hours are expanded (DST-safe, see lib/time.js).
 */
import prisma from '../lib/prisma.js';
import { badRequest, notFound } from '../lib/errors.js';
import {
  expandWorkingWindows,
  mergeWindows,
  subtractWindows,
  intersectWindows,
  isoWeekdayList,
  addMinutes,
  safeZone,
  toDate,
  overlaps,
} from '../lib/time.js';
import { AVAILABILITY_KIND, ROLES } from '../../../shared/constants.js';
import { getSettings } from './settings.service.js';
import { SETTING_KEYS } from '../../../shared/constants.js';

/**
 * If two available slots overlap, filter out the shorter one.
 * Blackout windows (UNAVAILABLE) are preserved.
 */
export function filterNonRedundantAvailability(rows) {
  if (!rows || !rows.length) return [];
  return rows.filter((w, idx) => {
    if (w.kind === AVAILABILITY_KIND.UNAVAILABLE) return true;
    const wStart = toDate(w.startUtc).getTime();
    const wEnd = toDate(w.endUtc).getTime();
    const wDur = wEnd - wStart;

    const hasLongerOverlapping = rows.some((other, otherIdx) => {
      if (otherIdx === idx) return false;
      if (other.kind === AVAILABILITY_KIND.UNAVAILABLE) return false;
      const oStart = toDate(other.startUtc).getTime();
      const oEnd = toDate(other.endUtc).getTime();
      const doesOverlap = wStart < oEnd && oStart < wEnd;
      if (!doesOverlap) return false;

      const oDur = oEnd - oStart;
      if (oDur > wDur) return true;
      if (oDur === wDur && otherIdx < idx) return true;
      return false;
    });

    return !hasLongerOverlapping;
  });
}

/** Persisted declared windows for a user inside a range (plus a little padding). */
export async function getDeclaredWindows(userId, rangeStart, rangeEnd) {
  const rows = await prisma.availabilityWindow.findMany({
    where: {
      userId,
      startUtc: { lt: toDate(rangeEnd) },
      endUtc: { gt: toDate(rangeStart) },
    },
    orderBy: { startUtc: 'asc' },
  });
  return filterNonRedundantAvailability(rows);
}

/** Bookings that block a user, padded by `bufferMinutes` on each side. */
export async function getBlockingBookings(userId, rangeStart, rangeEnd, bufferMinutes = 0) {
  const rows = await prisma.booking.findMany({
    where: {
      userId,
      startUtc: { lt: addMinutes(rangeEnd, bufferMinutes) },
      endUtc: { gt: addMinutes(rangeStart, -bufferMinutes) },
    },
    orderBy: { startUtc: 'asc' },
  });
  return rows.map((b) => ({
    start: addMinutes(b.startUtc, -bufferMinutes),
    end: addMinutes(b.endUtc, bufferMinutes),
    bookingId: b.id,
    interviewId: b.interviewId,
  }));
}

/**
 * Compute effective free windows for one user.
 *
 * @param {object} p
 * @param {string} p.userId
 * @param {Date} p.rangeStart
 * @param {Date} p.rangeEnd
 * @param {number} [p.bufferMinutes]
 * @param {{startMinute:number,endMinute:number,weekdays:number[]}} [p.workingHours]
 *        When omitted, declared AVAILABLE windows alone define the base.
 * @param {string} [p.excludeInterviewId] ignore this interview's own bookings
 *        (needed when rescheduling an interview onto a new slot).
 */
export async function computeFreeWindows({
  userId,
  rangeStart,
  rangeEnd,
  bufferMinutes = 0,
  workingHours = null,
  timezone = 'UTC',
  excludeInterviewId = null,
}) {
  const declared = await getDeclaredWindows(userId, rangeStart, rangeEnd);

  const available = declared
    .filter((w) => w.kind === AVAILABILITY_KIND.AVAILABLE || w.kind === AVAILABILITY_KIND.PREFERRED)
    .map((w) => ({ start: w.startUtc, end: w.endUtc, kind: w.kind }));

  const unavailable = declared
    .filter((w) => w.kind === AVAILABILITY_KIND.UNAVAILABLE)
    .map((w) => ({ start: w.startUtc, end: w.endUtc }));

  const preferred = mergeWindows(
    declared.filter((w) => w.kind === AVAILABILITY_KIND.PREFERRED).map((w) => ({ start: w.startUtc, end: w.endUtc }))
  );

  // Base: explicit availability wins; otherwise fall back to working hours.
  let base;
  if (available.length) {
    base = mergeWindows(available);
    if (workingHours) {
      // Declared availability is still bounded by the person's working pattern
      // unless they explicitly declared time outside it (which we honour, since
      // they opted in). We therefore union working hours with the declaration.
      base = mergeWindows([
        ...base,
      ]);
    }
  } else if (workingHours) {
    base = expandWorkingWindows({
      zone: timezone,
      startMinute: workingHours.startMinute,
      endMinute: workingHours.endMinute,
      weekdays: workingHours.weekdays,
      rangeStart,
      rangeEnd,
    });
  } else {
    base = [];
  }

  let bookings = await getBlockingBookings(userId, rangeStart, rangeEnd, bufferMinutes);
  if (excludeInterviewId) bookings = bookings.filter((b) => b.interviewId !== excludeInterviewId);

  const free = subtractWindows(base, [...unavailable, ...bookings]);

  return {
    free,
    preferred: intersectWindows(free, preferred),
    declaredCount: declared.length,
    hasDeclaredAvailability: available.length > 0,
    bookingCount: bookings.length,
    blockers: { unavailable, bookings },
  };
}

/** Convenience: interviewer free windows using their profile working pattern. */
export async function interviewerFreeWindows(interviewer, rangeStart, rangeEnd, bufferMinutes, excludeInterviewId) {
  return computeFreeWindows({
    userId: interviewer.userId,
    rangeStart,
    rangeEnd,
    bufferMinutes,
    timezone: interviewer.user?.timezone || 'UTC',
    workingHours: {
      startMinute: interviewer.workStartMinute,
      endMinute: interviewer.workEndMinute,
      weekdays: isoWeekdayList(interviewer.workDaysCsv),
    },
    excludeInterviewId,
  });
}

/** Convenience: candidate free windows (candidates have preferred hours, not working hours). */
export async function candidateFreeWindows(candidate, rangeStart, rangeEnd, bufferMinutes, excludeInterviewId) {
  const settings = await getSettings();
  return computeFreeWindows({
    userId: candidate.userId,
    rangeStart,
    rangeEnd,
    bufferMinutes: bufferMinutes ?? candidate.minBufferMinutes ?? 0,
    timezone: candidate.user?.timezone || 'UTC',
    // A candidate who has declared nothing is assumed reachable during their
    // stated preferred hours on weekdays - otherwise nothing could ever be
    // proposed to them, which is a worse failure than a slightly wide window.
    workingHours: {
      startMinute: candidate.preferredStartMinute ?? settings[SETTING_KEYS.DEFAULT_WORK_START_MINUTE],
      endMinute: candidate.preferredEndMinute ?? settings[SETTING_KEYS.DEFAULT_WORK_END_MINUTE],
      weekdays: [1, 2, 3, 4, 5],
    },
    excludeInterviewId,
  });
}

const windowInputToUtc = (w) => {
  const start = new Date(w.startUtc);
  const end = new Date(w.endUtc);
  if (Number.isNaN(+start) || Number.isNaN(+end)) throw badRequest('Invalid availability timestamps');
  if (end <= start) throw badRequest('Availability window must end after it starts');
  if (+end - +start > 16 * 60 * 60 * 1000) {
    throw badRequest('A single availability window cannot exceed 16 hours');
  }
  return { start, end };
};

/**
 * Replace or append availability windows for a user.
 * `mode: "replace"` clears future windows of the same kind first, which is what
 * the UI does when someone re-draws their week.
 */
export async function setAvailability(userId, windows, { mode = 'append', timezone = 'UTC', note = null } = {}) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('User not found');

  const prepared = windows.map((w) => {
    const { start, end } = windowInputToUtc(w);
    return {
      userId,
      startUtc: start,
      endUtc: end,
      kind: w.kind || AVAILABILITY_KIND.AVAILABLE,
      sourceTimezone: safeZone(w.timezone || timezone),
      note: w.note ?? note,
    };
  });

  // Filter any overlapping windows within the submitted batch so shorter slots are omitted.
  let nonRedundantPrepared = filterNonRedundantAvailability(prepared);

  return prisma.$transaction(async (tx) => {
    if (mode === 'replace') {
      await tx.availabilityWindow.deleteMany({
        where: { userId, startUtc: { gte: new Date() } },
      });
    } else {
      // In append mode, check against existing available windows
      const existingAvailable = await tx.availabilityWindow.findMany({
        where: {
          userId,
          kind: { in: [AVAILABILITY_KIND.AVAILABLE, AVAILABILITY_KIND.PREFERRED] },
        },
      });

      const toInsert = [];
      const toDeleteIds = [];

      for (const p of nonRedundantPrepared) {
        if (p.kind === AVAILABILITY_KIND.UNAVAILABLE) {
          toInsert.push(p);
          continue;
        }

        const pStart = toDate(p.startUtc).getTime();
        const pEnd = toDate(p.endUtc).getTime();
        const pDur = pEnd - pStart;

        const overlapping = existingAvailable.filter((e) => {
          if (toDeleteIds.includes(e.id)) return false;
          const eStart = toDate(e.startUtc).getTime();
          const eEnd = toDate(e.endUtc).getTime();
          return pStart < eEnd && eStart < pEnd;
        });

        // If an existing available slot already overlaps and is longer or equal, skip inserting p (shorter/duplicate)
        const hasLonger = overlapping.some((e) => {
          const eDur = toDate(e.endUtc).getTime() - toDate(e.startUtc).getTime();
          return eDur >= pDur;
        });

        if (hasLonger) {
          continue;
        }

        // If p is longer than existing overlapping slots, remove the shorter existing slots
        for (const e of overlapping) {
          const eDur = toDate(e.endUtc).getTime() - toDate(e.startUtc).getTime();
          if (eDur < pDur) {
            toDeleteIds.push(e.id);
          }
        }

        toInsert.push(p);
      }

      if (toDeleteIds.length) {
        await tx.availabilityWindow.deleteMany({
          where: { id: { in: toDeleteIds } },
        });
      }

      nonRedundantPrepared = toInsert;
    }

    if (nonRedundantPrepared.length) await tx.availabilityWindow.createMany({ data: nonRedundantPrepared });
    const rows = await tx.availabilityWindow.findMany({
      where: { userId, endUtc: { gte: new Date() } },
      orderBy: { startUtc: 'asc' },
    });
    return filterNonRedundantAvailability(rows);
  });
}

export async function deleteAvailabilityWindow(userId, windowId) {
  const row = await prisma.availabilityWindow.findUnique({ where: { id: windowId } });
  if (!row || row.userId !== userId) throw notFound('Availability window not found');
  await prisma.availabilityWindow.delete({ where: { id: windowId } });
  return { ok: true };
}

export async function listAvailability(userId, { from, to } = {}) {
  const rangeStart = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rangeEnd = to ? new Date(to) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.availabilityWindow.findMany({
    where: { userId, startUtc: { lt: rangeEnd }, endUtc: { gt: rangeStart } },
    orderBy: { startUtc: 'asc' },
  });
  return filterNonRedundantAvailability(rows);
}

/**
 * Apply AI-parsed natural-language constraints as concrete availability windows.
 * The AI only ever produces *structured constraints*; this deterministic
 * function is what turns them into rows, so a hallucinated field can never
 * create a booking.
 */
export async function applyParsedConstraints(userId, constraints, { timezone, rangeDays = 21 } = {}) {
  const zone = safeZone(timezone);
  const now = new Date();
  const rangeEnd = new Date(now.getTime() + rangeDays * 24 * 60 * 60 * 1000);

  const weekdayMap = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };
  const toWeekday = (d) => weekdayMap[String(d).toLowerCase().slice(0, 20)] ?? null;

  const days = (constraints.days || []).map(toWeekday).filter(Boolean);
  const avoidDays = (constraints.avoid_days || []).map(toWeekday).filter(Boolean);
  const allowed = (days.length ? days : [1, 2, 3, 4, 5]).filter((d) => !avoidDays.includes(d));

  const [sh, sm] = String(constraints.start_time || '09:00').split(':').map(Number);
  const [eh, em] = String(constraints.end_time || '18:00').split(':').map(Number);
  const startMinute = Math.min(Math.max((sh || 0) * 60 + (sm || 0), 0), 24 * 60 - 1);
  const endMinute = Math.min(Math.max((eh || 0) * 60 + (em || 0), startMinute + 30), 24 * 60);

  const available = expandWorkingWindows({
    zone,
    startMinute,
    endMinute,
    weekdays: allowed,
    rangeStart: now,
    rangeEnd,
  });

  // Explicit blackout dates become UNAVAILABLE rows so they survive re-parsing.
  const unavailable = [];
  for (const iso of constraints.unavailable_dates || []) {
    const day = new Date(`${iso}T00:00:00Z`);
    if (!Number.isNaN(+day)) {
      unavailable.push({
        startUtc: day.toISOString(),
        endUtc: new Date(+day + 24 * 60 * 60 * 1000).toISOString(),
        kind: AVAILABILITY_KIND.UNAVAILABLE,
      });
    }
  }

  const rows = [
    ...available.map((w) => ({
      startUtc: w.start.toISOString(),
      endUtc: w.end.toISOString(),
      kind: AVAILABILITY_KIND.AVAILABLE,
      timezone: zone,
      note: 'Derived from natural-language availability',
    })),
    ...unavailable,
  ];

  return setAvailability(userId, rows, { mode: 'replace', timezone: zone });
}

export { AVAILABILITY_KIND, ROLES };
