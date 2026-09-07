/** Jobs and applications - the hiring pipeline above the scheduling layer. */
import prisma from '../lib/prisma.js';
import { notFound, conflict, badRequest } from '../lib/errors.js';
import { parseArray, parseObject, stringifyJson } from '../lib/json.js';
import { upsertSkillsByName } from './skill.service.js';
import { semanticSkillMatch } from './ai.service.js';

const jobInclude = {
  recruiter: { include: { user: { select: { id: true, name: true, email: true } } } },
  _count: { select: { applications: true } },
};

export function shapeJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    department: row.department,
    location: row.location,
    employmentType: row.employmentType,
    experienceMin: row.experienceMin,
    experienceMax: row.experienceMax,
    requiredSkills: parseArray(row.requiredSkillsJson),
    interviewWindowStart: row.interviewWindowStart,
    interviewWindowEnd: row.interviewWindowEnd,
    status: row.status,
    recruiter: row.recruiter ? { id: row.recruiter.id, name: row.recruiter.user?.name } : null,
    applicationCount: row._count?.applications ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Create a job from what the recruiter typed.
 *
 * The required skills are entered by hand, not inferred: a job description is
 * already a structured statement of intent, and guessing at it only introduced
 * skills the recruiter never asked for. Those skills are what interviewers are
 * matched against, so they stay exactly as entered.
 */
const toWindowDates = (data) => ({
  ...data,
  ...(data.interviewWindowStart ? { interviewWindowStart: new Date(data.interviewWindowStart) } : {}),
  ...(data.interviewWindowEnd ? { interviewWindowEnd: new Date(data.interviewWindowEnd) } : {}),
});

export async function createJob({ recruiterId, requiredSkills, ...data }) {
  const skills = requiredSkills || [];

  // Register the skills in the taxonomy so matching can key off them.
  if (skills.length) await upsertSkillsByName(prisma, skills.map((s) => s.name));

  const job = await prisma.job.create({
    data: {
      ...toWindowDates(data),
      recruiterId,
      requiredSkillsJson: stringifyJson(skills),
    },
    include: jobInclude,
  });

  return { job: shapeJob(job) };
}

export async function updateJob(id, data) {
  const { requiredSkills, ...rest } = data;
  if (requiredSkills) await upsertSkillsByName(prisma, requiredSkills.map((s) => s.name));
  const row = await prisma.job.update({
    where: { id },
    data: { ...toWindowDates(rest), ...(requiredSkills ? { requiredSkillsJson: stringifyJson(requiredSkills) } : {}) },
    include: jobInclude,
  });
  return shapeJob(row);
}

export async function getJob(id) {
  const row = await prisma.job.findUnique({ where: { id }, include: jobInclude });
  if (!row) throw notFound('Job not found');
  return shapeJob(row);
}

export async function listJobs({ status, recruiterId, search } = {}) {
  const where = {};
  if (status) where.status = status;
  if (recruiterId) where.recruiterId = recruiterId;
  if (search) where.title = { contains: search };
  const rows = await prisma.job.findMany({ where, include: jobInclude, orderBy: { createdAt: 'desc' } });
  return rows.map(shapeJob);
}

/** Attach a candidate to a job and score their resume skills against the JD. */
export async function createApplication({ jobId, candidateId }) {
  const [job, candidate] = await Promise.all([
    prisma.job.findUnique({ where: { id: jobId } }),
    prisma.candidateProfile.findUnique({ where: { id: candidateId }, include: { skills: { include: { skill: true } } } }),
  ]);
  if (!job) throw notFound('Job not found');
  if (!candidate) throw notFound('Candidate not found');

  const existing = await prisma.application.findUnique({
    where: { jobId_candidateId: { jobId, candidateId } },
  });
  if (existing) throw conflict('This candidate has already been added to this job', 'DUPLICATE_APPLICATION');

  const required = parseArray(job.requiredSkillsJson);
  const offered = candidate.skills.map((s) => ({ name: s.skill.name, proficiency: s.proficiency }));

  let matchScore = null;
  let breakdown = null;
  if (required.length && offered.length) {
    const match = await semanticSkillMatch(required, offered);
    matchScore = match.data?.overall ?? null;
    breakdown = { ...match.data, provider: match.provider, fallbackUsed: match.fallbackUsed };
  }

  return prisma.application.create({
    data: {
      jobId,
      candidateId,
      matchScore,
      matchBreakdownJson: breakdown ? stringifyJson(breakdown) : null,
    },
    include: {
      job: true,
      candidate: { include: { user: { select: { name: true, email: true, timezone: true } } } },
    },
  });
}

export async function listApplications({ jobId, candidateId, status } = {}) {
  const where = {};
  if (jobId) where.jobId = jobId;
  if (candidateId) where.candidateId = candidateId;
  if (status) where.status = status;

  const rows = await prisma.application.findMany({
    where,
    include: {
      job: { select: { id: true, title: true, department: true, requiredSkillsJson: true } },
      candidate: { include: { user: { select: { name: true, email: true, timezone: true } } } },
      requests: {
        select: { id: true, roundNumber: true, roundName: true, interviewType: true, status: true },
        orderBy: { roundNumber: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return rows.map((a) => ({
    id: a.id,
    status: a.status,
    stage: a.stage,
    matchScore: a.matchScore,
    matchBreakdown: parseObject(a.matchBreakdownJson),
    job: { id: a.job.id, title: a.job.title, department: a.job.department, requiredSkills: parseArray(a.job.requiredSkillsJson) },
    candidate: {
      id: a.candidate.id,
      name: a.candidate.user.name,
      email: a.candidate.user.email,
      timezone: a.candidate.user.timezone,
      headline: a.candidate.headline,
    },
    rounds: a.requests,
    createdAt: a.createdAt,
  }));
}

export async function updateApplicationStage(id, { status, stage }) {
  const app = await prisma.application.findUnique({ where: { id } });
  if (!app) throw notFound('Application not found');
  if (status && !['ACTIVE', 'HIRED', 'REJECTED', 'WITHDRAWN'].includes(status)) {
    throw badRequest('Invalid application status');
  }
  return prisma.application.update({ where: { id }, data: { ...(status ? { status } : {}), ...(stage ? { stage } : {}) } });
}
