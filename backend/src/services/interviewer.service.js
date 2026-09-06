/** Interviewer profile, skills, workload accounting. */
import prisma from '../lib/prisma.js';
import { notFound } from '../lib/errors.js';
import { csvToArray, arrayToCsv, parseArray } from '../lib/json.js';
import { upsertSkillsByName } from './skill.service.js';
import { ACTIVE_INTERVIEW_STATUSES, INTERVIEW_STATUS } from '../../../shared/constants.js';
import { isoWeekdayList, localWeekday, DateTime } from '../lib/time.js';

const interviewerInclude = {
  user: { select: { id: true, name: true, email: true, timezone: true, phone: true, avatarSeed: true, isActive: true } },
  skills: { include: { skill: true } },
};

export function shapeInterviewer(row, extras = {}) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    name: row.user?.name,
    email: row.user?.email,
    timezone: row.user?.timezone,
    phone: row.user?.phone ?? null,
    avatarSeed: row.user?.avatarSeed ?? null,
    title: row.title,
    department: row.department,
    seniority: row.seniority,
    yearsExperience: row.yearsExperience,
    isActive: row.isActive && row.user?.isActive !== false,
    autoAcceptEnabled: row.autoAcceptEnabled,
    bioText: row.bioText,
    interviewTypes: csvToArray(row.interviewTypesCsv),
    workingHours: {
      startMinute: row.workStartMinute,
      endMinute: row.workEndMinute,
      weekdays: isoWeekdayList(row.workDaysCsv),
    },
    limits: {
      maxInterviewsPerDay: row.maxInterviewsPerDay,
      maxInterviewsPerWeek: row.maxInterviewsPerWeek,
    },
    skills: (row.skills || []).map((s) => ({
      id: s.skillId,
      name: s.skill.name,
      category: s.skill.category,
      proficiency: s.proficiency,
      yearsExperience: s.yearsExperience,
    })),
    ...extras,
  };
}

export async function getInterviewerById(id, { withWorkload = false } = {}) {
  const row = await prisma.interviewerProfile.findUnique({ where: { id }, include: interviewerInclude });
  if (!row) throw notFound('Interviewer not found');
  const extras = withWorkload ? { workload: await computeWorkload(id) } : {};
  return shapeInterviewer(row, extras);
}

export async function getInterviewerByUserId(userId) {
  const row = await prisma.interviewerProfile.findUnique({ where: { userId }, include: interviewerInclude });
  if (!row) throw notFound('Interviewer profile not found for this account');
  return shapeInterviewer(row, { workload: await computeWorkload(row.id) });
}

export async function listInterviewers({ search, skill, interviewType, activeOnly = true, withWorkload = false } = {}) {
  const where = {};
  if (activeOnly) where.isActive = true;
  if (search) where.OR = [{ user: { name: { contains: search } } }, { title: { contains: search } }];
  if (skill) where.skills = { some: { skill: { name: { contains: skill } } } };
  if (interviewType) where.interviewTypesCsv = { contains: interviewType };

  const rows = await prisma.interviewerProfile.findMany({
    where,
    include: interviewerInclude,
    orderBy: { user: { name: 'asc' } },
  });

  if (!withWorkload) return rows.map((r) => shapeInterviewer(r));
  const loads = await computeWorkloadBulk(rows.map((r) => r.id));
  return rows.map((r) => shapeInterviewer(r, { workload: loads.get(r.id) }));
}

export async function updateInterviewer(id, data) {
  const existing = await prisma.interviewerProfile.findUnique({ where: { id } });
  if (!existing) throw notFound('Interviewer not found');

  const { name, timezone, phone, skills, interviewTypes, workingHours, limits, ...rest } = data;

  const updated = await prisma.$transaction(async (tx) => {
    if (name || timezone || phone !== undefined) {
      await tx.user.update({
        where: { id: existing.userId },
        data: {
          ...(name ? { name } : {}),
          ...(timezone ? { timezone } : {}),
          ...(phone !== undefined ? { phone } : {}),
        },
      });
    }

    if (Array.isArray(skills)) {
      const resolved = await upsertSkillsByName(tx, skills.map((s) => s.name));
      await tx.interviewerSkill.deleteMany({ where: { interviewerId: id } });
      await tx.interviewerSkill.createMany({
        data: skills.map((s) => ({
          interviewerId: id,
          skillId: resolved.get(s.name.toLowerCase()).id,
          proficiency: Math.min(Math.max(Number(s.proficiency) || 3, 1), 5),
          yearsExperience: Number(s.yearsExperience) || 0,
        })),
      });
    }

    return tx.interviewerProfile.update({
      where: { id },
      data: {
        ...rest,
        ...(interviewTypes ? { interviewTypesCsv: arrayToCsv(interviewTypes) } : {}),
        ...(workingHours
          ? {
              workStartMinute: workingHours.startMinute,
              workEndMinute: workingHours.endMinute,
              workDaysCsv: arrayToCsv(workingHours.weekdays),
            }
          : {}),
        ...(limits
          ? {
              maxInterviewsPerDay: limits.maxInterviewsPerDay,
              maxInterviewsPerWeek: limits.maxInterviewsPerWeek,
            }
          : {}),
      },
      include: interviewerInclude,
    });
  });

  return shapeInterviewer(updated);
}

/**
 * Workload for the rolling 7-day window plus per-day counts, expressed against
 * the interviewer's own declared limits. This feeds both the matching score and
 * the Control Tower overload detector.
 */
export async function computeWorkload(interviewerId, { days = 7 } = {}) {
  const map = await computeWorkloadBulk([interviewerId], { days });
  return map.get(interviewerId);
}

export async function computeWorkloadBulk(interviewerIds, { days = 7, from = new Date() } = {}) {
  const result = new Map();
  if (!interviewerIds.length) return result;

  const rangeStart = new Date(from.getTime() - 24 * 60 * 60 * 1000);
  const rangeEnd = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);

  const [profiles, seats] = await Promise.all([
    prisma.interviewerProfile.findMany({
      where: { id: { in: interviewerIds } },
      include: { user: { select: { timezone: true } } },
    }),
    prisma.interviewPanelMember.findMany({
      where: {
        interviewerId: { in: interviewerIds },
        responseStatus: { not: 'DECLINED' },
        interview: {
          status: { in: ACTIVE_INTERVIEW_STATUSES },
          startUtc: { gte: rangeStart, lt: rangeEnd },
        },
      },
      include: { interview: { select: { id: true, startUtc: true, endUtc: true, status: true } } },
    }),
  ]);

  const byInterviewer = new Map(interviewerIds.map((id) => [id, []]));
  for (const seat of seats) byInterviewer.get(seat.interviewerId)?.push(seat.interview);

  for (const profile of profiles) {
    const items = byInterviewer.get(profile.id) || [];
    const zone = profile.user?.timezone || 'UTC';

    const perDay = new Map();
    let totalMinutes = 0;
    for (const iv of items) {
      const dayKey = DateTime.fromJSDate(iv.startUtc, { zone }).toISODate();
      perDay.set(dayKey, (perDay.get(dayKey) || 0) + 1);
      totalMinutes += (iv.endUtc - iv.startUtc) / 60000;
    }

    const weekCount = items.length;
    const weeklyCapacity = Math.max(profile.maxInterviewsPerWeek, 1);
    const utilization = Math.min(weekCount / weeklyCapacity, 2);
    const busiestDay = Math.max(0, ...perDay.values());

    result.set(profile.id, {
      interviewerId: profile.id,
      windowDays: days,
      upcomingCount: weekCount,
      totalMinutes,
      perDay: Object.fromEntries(perDay),
      busiestDayCount: busiestDay,
      maxPerDay: profile.maxInterviewsPerDay,
      maxPerWeek: profile.maxInterviewsPerWeek,
      utilization: Number(utilization.toFixed(3)),
      utilizationPercent: Math.round(utilization * 100),
      level: utilization >= 1 ? 'OVERLOADED' : utilization >= 0.7 ? 'HIGH' : utilization >= 0.4 ? 'MEDIUM' : 'LOW',
      atDailyLimit: busiestDay >= profile.maxInterviewsPerDay,
    });
  }

  for (const id of interviewerIds) {
    if (!result.has(id)) {
      result.set(id, {
        interviewerId: id,
        upcomingCount: 0,
        utilization: 0,
        utilizationPercent: 0,
        level: 'LOW',
        perDay: {},
        busiestDayCount: 0,
        atDailyLimit: false,
      });
    }
  }
  return result;
}

/** Count of interviews already assigned to an interviewer on a given local day. */
export async function countInterviewsOnLocalDay(interviewerId, instantUtc, zone) {
  const day = DateTime.fromJSDate(instantUtc, { zone: zone || 'UTC' });
  const start = day.startOf('day').toJSDate();
  const end = day.endOf('day').toJSDate();
  return prisma.interviewPanelMember.count({
    where: {
      interviewerId,
      responseStatus: { not: 'DECLINED' },
      interview: { status: { in: ACTIVE_INTERVIEW_STATUSES }, startUtc: { gte: start, lte: end } },
    },
  });
}

export async function interviewerAssignments(interviewerId, { upcomingOnly = false } = {}) {
  return prisma.interviewPanelMember.findMany({
    where: {
      interviewerId,
      ...(upcomingOnly
        ? { interview: { startUtc: { gte: new Date() }, status: { in: ACTIVE_INTERVIEW_STATUSES } } }
        : {}),
    },
    include: {
      interview: {
        include: {
          request: { include: { application: { include: { job: true, candidate: { include: { user: true } } } } } },
          meeting: true,
          feedback: true,
        },
      },
    },
    orderBy: { interview: { startUtc: 'asc' } },
  });
}

/** Skills an interviewer can cover, as a flat lowercase set (used by matching). */
export const interviewerSkillSet = (interviewer) =>
  new Set((interviewer.skills || []).map((s) => (s.skill?.name || s.name || '').toLowerCase()));

export { INTERVIEW_STATUS, parseArray };
