/** Candidate profile, skills and resume handling. */
import prisma from '../lib/prisma.js';
import { notFound, badRequest } from '../lib/errors.js';
import { parseObject, parseArray, stringifyJson } from '../lib/json.js';
import { upsertSkillsByName } from './skill.service.js';
import { ACTIVE_INTERVIEW_STATUSES } from '../../../shared/constants.js';
import { fullInterviewInclude } from './interview.shape.js';

const candidateInclude = {
  user: { select: { id: true, name: true, email: true, timezone: true, phone: true, avatarSeed: true } },
  skills: { include: { skill: true } },
  applications: { include: { job: true } },
};

export function shapeCandidate(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    candidateNumber: row.candidateNumber || `CND-${row.id.slice(-4).toUpperCase()}`,
    name: row.user?.name,
    email: row.user?.email,
    timezone: row.user?.timezone,
    phone: row.user?.phone ?? null,
    avatarSeed: row.user?.avatarSeed ?? null,
    headline: row.headline,
    yearsExperience: row.yearsExperience,
    currentCompany: row.currentCompany,
    location: row.location,
    resumeUrl: row.resumeUrl,
    hasResumeText: Boolean(row.resumeText),
    applications: (row.applications || []).map((app) => ({
      id: app.id,
      jobId: app.jobId,
      jobTitle: app.job?.title || row.headline || 'Senior Software Engineer',
      department: app.job?.department || 'Engineering',
      status: app.status,
      stage: app.stage,
      matchScore: app.matchScore,
    })),
    preferences: {
      maxInterviewsPerDay: row.maxInterviewsPerDay,
      minBufferMinutes: row.minBufferMinutes,
      preferredStartMinute: row.preferredStartMinute,
      preferredEndMinute: row.preferredEndMinute,
    },
    availabilityNoteRaw: row.availabilityNoteRaw,
    availabilityConstraints: parseObject(row.availabilityConstraintsJson),
    skills: (row.skills || []).map((s) => ({
      id: s.skillId,
      name: s.skill.name,
      category: s.skill.category,
      proficiency: s.proficiency,
      source: s.source,
    })),
  };
}

export async function getCandidateById(id) {
  const row = await prisma.candidateProfile.findUnique({ where: { id }, include: candidateInclude });
  if (!row) throw notFound('Candidate not found');
  return shapeCandidate(row);
}

export async function getCandidateByUserId(userId) {
  const row = await prisma.candidateProfile.findUnique({ where: { userId }, include: candidateInclude });
  if (!row) throw notFound('Candidate profile not found for this account');
  return shapeCandidate(row);
}

export async function listCandidates({ search, skill, take = 50, skip = 0 } = {}) {
  const where = {};
  if (search) {
    where.OR = [
      { user: { name: { contains: search } } },
      { user: { email: { contains: search } } },
      { headline: { contains: search } },
    ];
  }
  if (skill) where.skills = { some: { skill: { name: { contains: skill } } } };

  const [rows, total] = await Promise.all([
    prisma.candidateProfile.findMany({
      where,
      include: candidateInclude,
      take: Math.min(take, 200),
      skip,
      orderBy: { user: { name: 'asc' } },
    }),
    prisma.candidateProfile.count({ where }),
  ]);
  return { total, items: rows.map(shapeCandidate) };
}

export async function updateCandidate(id, data) {
  const existing = await prisma.candidateProfile.findUnique({ where: { id } });
  if (!existing) throw notFound('Candidate not found');

  const { name, timezone, phone, skills, ...profileData } = data;

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
      await tx.candidateSkill.deleteMany({ where: { candidateId: id } });
      await tx.candidateSkill.createMany({
        data: skills.map((s) => ({
          candidateId: id,
          skillId: resolved.get(s.name.toLowerCase()).id,
          proficiency: Math.min(Math.max(Number(s.proficiency) || 3, 1), 5),
          source: s.source || 'SELF',
        })),
      });
    }

    return tx.candidateProfile.update({
      where: { id },
      data: profileData,
      include: candidateInclude,
    });
  });

  return shapeCandidate(updated);
}

export async function attachResume(candidateId, { resumeUrl, resumeText }) {
  const row = await prisma.candidateProfile.update({
    where: { id: candidateId },
    data: { resumeUrl, resumeText: resumeText || undefined },
    include: candidateInclude,
  });
  return shapeCandidate(row);
}

export async function saveAvailabilityConstraints(candidateId, rawText, constraints) {
  await prisma.candidateProfile.update({
    where: { id: candidateId },
    data: {
      availabilityNoteRaw: rawText,
      availabilityConstraintsJson: stringifyJson(constraints),
      ...(constraints?.max_interviews_per_day
        ? { maxInterviewsPerDay: Math.min(Math.max(Number(constraints.max_interviews_per_day), 1), 6) }
        : {}),
    },
  });
}

/** Interviews visible to a candidate, newest first. */
export async function candidateInterviews(candidateId, { includePast = true } = {}) {
  const rows = await prisma.interview.findMany({
    where: {
      request: { application: { candidateId } },
      ...(includePast ? {} : { status: { in: ACTIVE_INTERVIEW_STATUSES } }),
    },
    // Use the canonical include so shapeInterview can fill every field it
    // promises - a partial include silently yields nulls for health,
    // calendarEvent, incidents and the candidate's own name.
    include: fullInterviewInclude,
    orderBy: { startUtc: 'desc' },
  });
  return rows;
}
