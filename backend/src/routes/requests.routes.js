import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole, loadOwnProfile } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { auditFromRequest } from '../services/audit.service.js';
import { parseArray, stringifyJson } from '../lib/json.js';
import { upsertSkillsByName } from '../services/skill.service.js';
import { badRequest, notFound, forbidden, conflict } from '../lib/errors.js';
import {
  AUDIT_ACTIONS,
  ROLES,
  INTERVIEW_TYPE_VALUES,
  REQUEST_STATUS,
  REQUEST_STATUS_VALUES,
  DEFAULT_ROUND_PLAN,
} from '../../../shared/constants.js';
import { getSettings } from '../services/settings.service.js';
import { SETTING_KEYS } from '../../../shared/constants.js';

const router = Router();
router.use(requireAuth);

const requestSchema = z.object({
  applicationId: z.string().min(5),
  roundNumber: z.coerce.number().int().min(1).max(12).default(1),
  roundName: z.string().trim().min(2).max(80),
  interviewType: z.enum(INTERVIEW_TYPE_VALUES),
  durationMinutes: z.coerce.number().int().min(15).max(480),
  requiredInterviewerCount: z.coerce.number().int().min(1).max(5).default(1),
  bufferMinutes: z.coerce.number().int().min(0).max(120).optional(),
  earliestUtc: z.string().datetime({ offset: true }),
  latestUtc: z.string().datetime({ offset: true }),
  requiredSkills: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        weight: z.coerce.number().min(0).max(1).default(0.8),
        mustHave: z.boolean().default(true),
      })
    )
    .max(30)
    .optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH']).default('NORMAL'),
  dependsOnRequestId: z.string().optional().nullable(),
});

function shapeRequest(r) {
  return {
    id: r.id,
    applicationId: r.applicationId,
    roundNumber: r.roundNumber,
    roundName: r.roundName,
    interviewType: r.interviewType,
    durationMinutes: r.durationMinutes,
    requiredInterviewerCount: r.requiredInterviewerCount,
    bufferMinutes: r.bufferMinutes,
    earliestUtc: r.earliestUtc,
    latestUtc: r.latestUtc,
    requiredSkills: parseArray(r.requiredSkillsJson),
    focusTopics: parseArray(r.focusTopicsJson),
    priority: r.priority,
    status: r.status,
    failureReason: r.failureReason,
    dependsOnRequestId: r.dependsOnRequestId,
    candidate: r.application?.candidate
      ? {
          id: r.application.candidate.id,
          name: r.application.candidate.user?.name,
          timezone: r.application.candidate.user?.timezone,
          headline: r.application.candidate.headline,
        }
      : null,
    job: r.application?.job ? { id: r.application.job.id, title: r.application.job.title } : null,
    proposalCount: r._count?.proposals,
    interviews: (r.interviews || []).map((i) => ({
      id: i.id,
      status: i.status,
      startUtc: i.startUtc,
      endUtc: i.endUtc,
    })),
    createdAt: r.createdAt,
  };
}

const requestInclude = {
  application: {
    include: {
      job: true,
      candidate: { include: { user: { select: { name: true, timezone: true, email: true } } } },
    },
  },
  interviews: { orderBy: { createdAt: 'desc' } },
  _count: { select: { proposals: true } },
};

router.get(
  '/',
  validateQuery(
    z.object({
      status: z.enum(REQUEST_STATUS_VALUES).optional(),
      applicationId: z.string().optional(),
      jobId: z.string().optional(),
      candidateId: z.string().optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const q = req.validatedQuery;
    const where = {};
    if (q.status) where.status = q.status;
    if (q.applicationId) where.applicationId = q.applicationId;
    if (q.jobId) where.application = { jobId: q.jobId };
    if (q.candidateId) where.application = { ...(where.application || {}), candidateId: q.candidateId };

    // Candidates only ever see their own rounds.
    if (req.user.role === ROLES.CANDIDATE) {
      const own = await loadOwnProfile(req);
      if (!own) throw forbidden('No candidate profile');
      where.application = { ...(where.application || {}), candidateId: own.id };
    } else if (req.user.role === ROLES.INTERVIEWER) {
      throw forbidden('Interviewers do not have access to the request queue');
    }

    const rows = await prisma.interviewRequest.findMany({
      where,
      include: requestInclude,
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    });
    res.json(rows.map(shapeRequest));
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await prisma.interviewRequest.findUnique({ where: { id: req.params.id }, include: requestInclude });
    if (!row) throw notFound('Interview request not found');
    if (req.user.role === ROLES.CANDIDATE) {
      const own = await loadOwnProfile(req);
      if (row.application.candidateId !== own?.id) throw forbidden('This request is not yours');
    }
    res.json(shapeRequest(row));
  })
);

router.post(
  '/',
  requireRole(ROLES.RECRUITER, ROLES.ADMIN),
  validateBody(requestSchema),
  asyncHandler(async (req, res) => {
    const body = req.body;
    const settings = await getSettings();

    const application = await prisma.application.findUnique({
      where: { id: body.applicationId },
      include: { job: true, candidate: { include: { user: true } } },
    });
    if (!application) throw notFound('Application not found');
    if (application.status !== 'ACTIVE') {
      throw conflict(`Cannot schedule for a ${application.status.toLowerCase()} application`, 'APPLICATION_INACTIVE');
    }

    const earliest = new Date(body.earliestUtc);
    const latest = new Date(body.latestUtc);
    if (latest <= earliest) throw badRequest('The latest date must be after the earliest date');
    if (latest < new Date()) throw badRequest('The date range is entirely in the past');
    const rangeMinutes = (latest - earliest) / 60000;
    if (rangeMinutes < body.durationMinutes) {
      throw badRequest(
        `The date range (${Math.round(rangeMinutes)} min) is shorter than the interview itself (${body.durationMinutes} min)`
      );
    }

    const duplicate = await prisma.interviewRequest.findFirst({
      where: {
        applicationId: body.applicationId,
        roundNumber: body.roundNumber,
        status: { in: [REQUEST_STATUS.PENDING, REQUEST_STATUS.PROPOSED, REQUEST_STATUS.SCHEDULED] },
      },
    });
    if (duplicate) {
      throw conflict(`Round ${body.roundNumber} already exists for this candidate`, 'DUPLICATE_ROUND', {
        requestId: duplicate.id,
      });
    }

    if (body.dependsOnRequestId) {
      const parent = await prisma.interviewRequest.findUnique({ where: { id: body.dependsOnRequestId } });
      if (!parent || parent.applicationId !== body.applicationId) {
        throw badRequest('The dependency must be another round for the same candidate');
      }
      if (parent.roundNumber >= body.roundNumber) {
        throw badRequest('A round can only depend on an earlier round');
      }
    }

    // Inherit the JD's skills when the recruiter did not specify any.
    let skills = body.requiredSkills;
    if (!skills?.length) skills = parseArray(application.job.requiredSkillsJson);
    if (skills.length) await upsertSkillsByName(prisma, skills.map((s) => s.name));

    const created = await prisma.interviewRequest.create({
      data: {
        applicationId: body.applicationId,
        roundNumber: body.roundNumber,
        roundName: body.roundName,
        interviewType: body.interviewType,
        durationMinutes: body.durationMinutes,
        requiredInterviewerCount: body.requiredInterviewerCount,
        bufferMinutes: body.bufferMinutes ?? settings[SETTING_KEYS.DEFAULT_BUFFER_MINUTES],
        earliestUtc: earliest,
        latestUtc: latest,
        requiredSkillsJson: stringifyJson(skills),
        priority: body.priority,
        dependsOnRequestId: body.dependsOnRequestId || null,
        createdById: req.user.id,
      },
      include: requestInclude,
    });

    await auditFromRequest(req, {
      action: AUDIT_ACTIONS.REQUEST_CREATED,
      entity: 'InterviewRequest',
      entityId: created.id,
      summary: `${created.roundName} requested for ${application.candidate.user.name} (${application.job.title})`,
      metadata: {
        interviewType: created.interviewType,
        durationMinutes: created.durationMinutes,
        panelSize: created.requiredInterviewerCount,
        skills: skills.map((s) => s.name),
      },
    });

    res.status(201).json(shapeRequest(created));
  })
);

router.put(
  '/:id',
  requireRole(ROLES.RECRUITER, ROLES.ADMIN),
  validateBody(requestSchema.partial().omit({ applicationId: true })),
  asyncHandler(async (req, res) => {
    const existing = await prisma.interviewRequest.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Interview request not found');
    if (existing.status === REQUEST_STATUS.SCHEDULED) {
      throw conflict('Cancel or reschedule the interview before editing this round', 'ALREADY_SCHEDULED');
    }

    const { requiredSkills, earliestUtc, latestUtc, ...rest } = req.body;
    const updated = await prisma.interviewRequest.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        ...(earliestUtc ? { earliestUtc: new Date(earliestUtc) } : {}),
        ...(latestUtc ? { latestUtc: new Date(latestUtc) } : {}),
        ...(requiredSkills ? { requiredSkillsJson: stringifyJson(requiredSkills) } : {}),
        // Editing constraints invalidates any open proposals.
        status: REQUEST_STATUS.PENDING,
      },
      include: requestInclude,
    });
    await prisma.slotProposal.updateMany({
      where: { requestId: req.params.id, status: 'OPEN' },
      data: { status: 'EXPIRED' },
    });

    res.json(shapeRequest(updated));
  })
);

router.delete(
  '/:id',
  requireRole(ROLES.RECRUITER, ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const existing = await prisma.interviewRequest.findUnique({
      where: { id: req.params.id },
      include: { interviews: { where: { status: { in: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'] } } } },
    });
    if (!existing) throw notFound('Interview request not found');
    if (existing.interviews.length) {
      throw conflict('Cancel the scheduled interview before deleting this round', 'HAS_ACTIVE_INTERVIEW');
    }
    await prisma.interviewRequest.update({
      where: { id: req.params.id },
      data: { status: REQUEST_STATUS.CANCELLED },
    });
    await auditFromRequest(req, {
      action: 'REQUEST_CANCELLED',
      entity: 'InterviewRequest',
      entityId: req.params.id,
      summary: `Round "${existing.roundName}" cancelled`,
    });
    res.json({ ok: true });
  })
);

/** Convenience: the standard round plan, used to pre-fill the builder UI. */
router.get('/meta/round-plan', (_req, res) => res.json(DEFAULT_ROUND_PLAN));

export default router;
