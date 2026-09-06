import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, loadOwnProfile } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  createJob,
  updateJob,
  getJob,
  listJobs,
  createApplication,
  listApplications,
  updateApplicationStage,
} from '../services/job.service.js';
import { auditFromRequest } from '../services/audit.service.js';
import { AUDIT_ACTIONS, ROLES } from '../../../shared/constants.js';
import { forbidden, notFound } from '../lib/errors.js';
import prisma from '../lib/prisma.js';

const router = Router();
router.use(requireAuth);

const skillSchema = z.object({
  name: z.string().trim().min(1).max(60),
  weight: z.coerce.number().min(0).max(1).default(0.8),
  mustHave: z.boolean().default(true),
});

const jobSchema = z.object({
  title: z.string().trim().min(2).max(140),
  description: z.string().trim().min(20).max(20000),
  department: z.string().trim().max(120).optional(),
  location: z.string().trim().max(120).optional(),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']).default('FULL_TIME'),
  experienceMin: z.coerce.number().min(0).max(50).optional(),
  experienceMax: z.coerce.number().min(0).max(60).optional(),
  requiredSkills: z.array(skillSchema).min(1).max(40),
});

router.get(
  '/',
  validateQuery(
    z.object({
      status: z.enum(['OPEN', 'PAUSED', 'CLOSED']).optional(),
      mine: z.coerce.boolean().default(false),
      search: z.string().trim().max(80).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const filter = { status: req.validatedQuery.status, search: req.validatedQuery.search };
    if (req.validatedQuery.mine && req.user.role === ROLES.RECRUITER) {
      const own = await loadOwnProfile(req);
      filter.recruiterId = own?.id;
    }
    res.json(await listJobs(filter));
  })
);

router.get('/:id', asyncHandler(async (req, res) => res.json(await getJob(req.params.id))));

router.post(
  '/',
  requireRole(ROLES.RECRUITER, ROLES.ADMIN),
  validateBody(jobSchema),
  asyncHandler(async (req, res) => {
    let recruiter = await loadOwnProfile(req);
    if (!recruiter && req.user.role === ROLES.ADMIN) {
      // Admins post on behalf of the first recruiter (demo convenience).
      recruiter = await prisma.recruiterProfile.findFirst();
      if (!recruiter) throw notFound('No recruiter profile exists to own this job');
    }
    if (!recruiter) throw forbidden('Recruiter profile missing');

    const { job } = await createJob({ ...req.body, recruiterId: recruiter.id });

    await auditFromRequest(req, {
      action: AUDIT_ACTIONS.JOB_CREATED,
      entity: 'Job',
      entityId: job.id,
      summary: `Job "${job.title}" created`,
      metadata: { skillCount: job.requiredSkills.length },
    });
    res.status(201).json({ job });
  })
);

router.put(
  '/:id',
  requireRole(ROLES.RECRUITER, ROLES.ADMIN),
  validateBody(jobSchema.partial()),
  asyncHandler(async (req, res) => {
    const job = await prisma.job.findUnique({ where: { id: req.params.id }, include: { recruiter: true } });
    if (!job) throw notFound('Job not found');
    const own = await loadOwnProfile(req);
    if (req.user.role === ROLES.RECRUITER && job.recruiterId !== own?.id) {
      throw forbidden('You can only edit jobs you own');
    }
    res.json(await updateJob(req.params.id, req.body));
  })
);

// ---------------------------------------------------------- applications ----

router.get(
  '/:id/applications',
  requireRole(ROLES.RECRUITER, ROLES.ADMIN),
  asyncHandler(async (req, res) => res.json(await listApplications({ jobId: req.params.id })))
);

router.post(
  '/:id/applications',
  requireRole(ROLES.RECRUITER, ROLES.ADMIN),
  validateBody(z.object({ candidateId: z.string().min(5) })),
  asyncHandler(async (req, res) => {
    const application = await createApplication({ jobId: req.params.id, candidateId: req.body.candidateId });
    await auditFromRequest(req, {
      action: 'APPLICATION_CREATED',
      entity: 'Application',
      entityId: application.id,
      summary: `${application.candidate.user.name} added to "${application.job.title}"`,
      metadata: { matchScore: application.matchScore },
    });
    res.status(201).json(application);
  })
);

export default router;
