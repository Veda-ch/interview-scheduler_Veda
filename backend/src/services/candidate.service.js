/** Candidate profile, skills and resume handling. */
import prisma from '../lib/prisma.js';
import { notFound, badRequest } from '../lib/errors.js';
import { parseObject, parseArray, stringifyJson } from '../lib/json.js';
import { upsertSkillsByName } from './skill.service.js';
import { ACTIVE_INTERVIEW_STATUSES } from '../../../shared/constants.js';

const candidateInclude = {
  user: { select: { id: true, name: true, email: true, timezone: true, phone: true, avatarSeed: true } },
  skills: { include: { skill: true } },
};

export function shapeCandidate(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
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
    resumeAnalysis: parseObject(row.resumeAnalysisJson),
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

/**
 * Persist a validated AI resume analysis and merge extracted skills into the
 * profile. Skills coming from AI are tagged `RESUME_AI` so the UI can show
 * provenance and a human can correct them - AI output is never silently
 * indistinguishable from user-entered data.
 */
export async function applyResumeAnalysis(candidateId, analysis, providerUsed = 'mock') {
  const skills = parseArray(stringifyJson(analysis?.skills || []));

  await prisma.$transaction(async (tx) => {
    await tx.candidateProfile.update({
      where: { id: candidateId },
      data: {
        resumeAnalysisJson: stringifyJson({ ...analysis, providerUsed, analyzedAt: new Date().toISOString() }),
        ...(analysis?.years_experience != null
          ? { yearsExperience: Number(analysis.years_experience) || 0 }
          : {}),
      },
    });

    if (skills.length) {
      const names = skills.map((s) => (typeof s === 'string' ? s : s.name)).filter(Boolean);
      const resolved = await upsertSkillsByName(tx, names);
      for (const raw of skills) {
        const name = typeof raw === 'string' ? raw : raw.name;
        if (!name) continue;
        const skill = resolved.get(name.toLowerCase());
        if (!skill) continue;
        const proficiency = Math.min(Math.max(Math.round(Number(raw?.proficiency) || 3), 1), 5);
        await tx.candidateSkill.upsert({
          where: { candidateId_skillId: { candidateId, skillId: skill.id } },
          update: { proficiency, source: 'RESUME_AI' },
          create: { candidateId, skillId: skill.id, proficiency, source: 'RESUME_AI' },
        });
      }
    }
  });

  return getCandidateById(candidateId);
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
    include: {
      request: { include: { application: { include: { job: true } } } },
      panel: { include: { interviewer: { include: { user: { select: { name: true, timezone: true } } } } } },
      meeting: true,
    },
    orderBy: { startUtc: 'desc' },
  });
  return rows;
}
