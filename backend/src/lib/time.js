/**
 * The time layer.
 *
 * Rules enforced here (and nowhere else in the codebase):
 *   1. Everything persisted is UTC. Timezones exist only at the edges.
 *   2. Working-hours windows are expanded per *local calendar day* using Luxon,
 *      so a DST transition shifts the UTC instants correctly instead of
 *      silently moving someone's 09:00 to 08:00.
 *   3. Interval algebra (merge / subtract / intersect) is centralised so the
 *      scheduler, the conflict detector and the Control Tower all agree.
 */
import { DateTime, Interval } from 'luxon';

export const MINUTE_MS = 60_000;

export const toDate = (value) => (value instanceof Date ? value : new Date(value));
export const toMs = (value) => toDate(value).getTime();
export const addMinutes = (date, minutes) => new Date(toMs(date) + minutes * MINUTE_MS);
export const diffMinutes = (a, b) => Math.round((toMs(a) - toMs(b)) / MINUTE_MS);

/** True when [aStart,aEnd) and [bStart,bEnd) share any instant. */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  return toMs(aStart) < toMs(bEnd) && toMs(bStart) < toMs(aEnd);
}

export function isValidZone(zone) {
  if (!zone || typeof zone !== 'string') return false;
  return DateTime.local().setZone(zone).isValid;
}

export const safeZone = (zone, fallback = 'UTC') => (isValidZone(zone) ? zone : fallback);

/** Minutes since local midnight for a UTC instant, in the given zone. */
export function localMinuteOfDay(utc, zone) {
  const dt = DateTime.fromJSDate(toDate(utc), { zone: safeZone(zone) });
  return dt.hour * 60 + dt.minute;
}

/** ISO weekday (Mon=1 .. Sun=7) of a UTC instant, in the given zone. */
export function localWeekday(utc, zone) {
  return DateTime.fromJSDate(toDate(utc), { zone: safeZone(zone) }).weekday;
}

export function formatInZone(utc, zone, fmt = "ccc dd LLL yyyy, HH:mm ZZZZ") {
  return DateTime.fromJSDate(toDate(utc), { zone: safeZone(zone) }).toFormat(fmt);
}

/** Local wall-clock label used in notifications, e.g. "Thu 12 Mar, 14:00 IST". */
export const humanSlot = (startUtc, endUtc, zone) =>
  `${formatInZone(startUtc, zone, "ccc dd LLL, HH:mm")}-${formatInZone(endUtc, zone, 'HH:mm ZZZZ')}`;

/**
 * Expand recurring working hours into concrete UTC windows over a range.
 * DST-safe: each local day is materialised in its own zone context.
 *
 * @param {object} p
 * @param {string} p.zone IANA zone
 * @param {number} p.startMinute minutes from local midnight (e.g. 540 = 09:00)
 * @param {number} p.endMinute   minutes from local midnight (e.g. 1080 = 18:00)
 * @param {number[]} p.weekdays  ISO weekdays allowed (Mon=1)
 * @param {Date} p.rangeStart UTC
 * @param {Date} p.rangeEnd   UTC
 * @returns {{start: Date, end: Date}[]}
 */
export function expandWorkingWindows({ zone, startMinute, endMinute, weekdays, rangeStart, rangeEnd }) {
  const tz = safeZone(zone);
  const allowed = new Set(weekdays && weekdays.length ? weekdays : [1, 2, 3, 4, 5]);
  const windows = [];

  let cursor = DateTime.fromJSDate(toDate(rangeStart), { zone: tz }).startOf('day');
  const last = DateTime.fromJSDate(toDate(rangeEnd), { zone: tz }).endOf('day');
  let guard = 0;

  while (cursor <= last && guard++ < 400) {
    if (allowed.has(cursor.weekday)) {
      // `plus({minutes})` from local midnight keeps the wall-clock intent across DST.
      const start = cursor.plus({ minutes: startMinute });
      const end = cursor.plus({ minutes: endMinute });
      if (end > start) {
        const s = new Date(Math.max(start.toJSDate().getTime(), toMs(rangeStart)));
        const e = new Date(Math.min(end.toJSDate().getTime(), toMs(rangeEnd)));
        if (e > s) windows.push({ start: s, end: e });
      }
    }
    cursor = cursor.plus({ days: 1 }).startOf('day');
  }
  return windows;
}

/** Merge overlapping/adjacent windows into a normalised, sorted set. */
export function mergeWindows(windows) {
  const sorted = windows
    .map((w) => ({ start: toDate(w.start), end: toDate(w.end) }))
    .filter((w) => w.end > w.start)
    .sort((a, b) => a.start - b.start);

  const out = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w.start <= last.end) {
      if (w.end > last.end) last.end = w.end;
    } else {
      out.push({ ...w });
    }
  }
  return out;
}

/** base minus blockers (interval difference). */
export function subtractWindows(base, blockers) {
  const blocks = mergeWindows(blockers);
  let result = mergeWindows(base);

  for (const b of blocks) {
    const next = [];
    for (const w of result) {
      if (!overlaps(w.start, w.end, b.start, b.end)) {
        next.push(w);
        continue;
      }
      if (w.start < b.start) next.push({ start: w.start, end: new Date(Math.min(+w.end, +b.start)) });
      if (w.end > b.end) next.push({ start: new Date(Math.max(+w.start, +b.end)), end: w.end });
    }
    result = next.filter((w) => w.end > w.start);
  }
  return result;
}

/** Pairwise intersection of two normalised window sets. */
export function intersectWindows(a, b) {
  const A = mergeWindows(a);
  const B = mergeWindows(b);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    const start = new Date(Math.max(+A[i].start, +B[j].start));
    const end = new Date(Math.min(+A[i].end, +B[j].end));
    if (end > start) out.push({ start, end });
    if (+A[i].end < +B[j].end) i += 1;
    else j += 1;
  }
  return out;
}

/** Intersect many window sets; empty input list means "no constraint" -> []. */
export function intersectAll(sets) {
  if (!sets.length) return [];
  return sets.reduce((acc, cur) => intersectWindows(acc, cur));
}

/**
 * Enumerate candidate start instants of `durationMinutes` inside `windows`,
 * aligned to `granularity` on the *local* clock of `zone` (so slots land on
 * :00/:15/:30/:45 for the participants, not on arbitrary UTC offsets).
 */
export function enumerateSlots({ windows, durationMinutes, granularityMinutes = 15, zone = 'UTC', limit = 500 }) {
  const tz = safeZone(zone);
  const slots = [];
  for (const w of mergeWindows(windows)) {
    let dt = DateTime.fromJSDate(toDate(w.start), { zone: tz });
    const rem = (dt.hour * 60 + dt.minute) % granularityMinutes;
    if (rem !== 0 || dt.second || dt.millisecond) {
      dt = dt.plus({ minutes: granularityMinutes - rem }).startOf('minute');
    }
    let guard = 0;
    while (guard++ < 5000) {
      const start = dt.toJSDate();
      const end = addMinutes(start, durationMinutes);
      if (+end > +w.end) break;
      slots.push({ start, end });
      if (slots.length >= limit) return slots;
      dt = dt.plus({ minutes: granularityMinutes });
    }
  }
  return slots;
}

/** Total minutes covered by a window set. */
export const windowMinutes = (windows) =>
  mergeWindows(windows).reduce((sum, w) => sum + (+w.end - +w.start) / MINUTE_MS, 0);

/** Distinct list of IANA zones -> max pairwise offset spread in hours, at a given instant. */
export function timezoneSpreadHours(zones, at = new Date()) {
  const offsets = [...new Set(zones.filter(isValidZone))].map(
    (z) => DateTime.fromJSDate(toDate(at), { zone: z }).offset / 60
  );
  if (offsets.length < 2) return 0;
  return Math.max(...offsets) - Math.min(...offsets);
}

/** True when the instant falls inside civil working hours in every given zone. */
export function withinAllWorkingHours(startUtc, endUtc, zones, startMinute = 480, endMinute = 1260) {
  return zones.every((z) => {
    const s = localMinuteOfDay(startUtc, z);
    const e = localMinuteOfDay(endUtc, z);
    // an interview crossing local midnight is by definition outside working hours
    if (e <= s) return false;
    return s >= startMinute && e <= endMinute;
  });
}

export const isoWeekdayList = (csv) =>
  String(csv || '1,2,3,4,5')
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 7);

export { DateTime, Interval };
