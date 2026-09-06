import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, requireInterviewerAccess, loadOwnProfile } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  getInterviewerById,
  listInterviewers,
  updateInterviewer,
  computeWorkload,
  interviewerAssignments,
} from '../services/interviewer.service.js';
import { listAvailability, setAvailability, deleteAvailabilityWindow } from '../services/availability.service.js';
import { auditFromRequest } from '../services/audit.service.js';
import { AUDIT_ACTIONS, ROLES, INTERVIEW_TYPE_VALUES, AVAILABILITY_KIND_VALUES } from '../../../shared/constants.js';
import { isValidZone } from '../lib/time.js';
import { badRequest, notFound } from '../lib/errors.js';
import prisma from '../lib/prisma.js';
import { shapeInterview } from '../services/interview.shape.js';

const router = Router();
router.use(requireAuth);

const meAlias = asyncHandler(async (req, _res, next) => {
  if (req.params.id === 'me') {
    const own = await loadOwnProfile(req);
    if (!own) throw notFound('You do not have an interviewer profile');
    req.params.id = own.id;
  }
  next();
});

router.get(
  '/',
  requireRole(ROLES.RECRUITER, ROLES.ADMIN, ROLES.INTERVIEWER),
  validateQuery(
    z.object({
      search: z.string().trim().max(80).optional(),
      skill: z.string().trim().max(60).optional(),
      interviewType: z.enum(INTERVIEW_TYPE_VALUES).optional(),
      withWorkload: z.coerce.boolean().default(false),
      activeOnly: z.coerce.boolean().default(true),
    })
  ),
  asyncHandler(async (req, res) => {
    res.json(await listInterviewers(req.validatedQuery));
  })
);

router.get(
  '/:id',
  meAlias,
  asyncHandler(async (req, res) => {
    // Interviewer directory is readable by all authenticated staff roles;
    // only the owner/recruiter/admin sees workload detail.
    const privileged =
      req.user.role === ROLES.RECRUITER ||
      req.user.role === ROLES.ADMIN ||
      (await loadOwnProfile(req))?.id === req.params.id;
    res.json(await getInterviewerById(req.params.id, { withWorkload: privileged }));
  })
);

const updateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  timezone: z.string().refine(isValidZone, 'Unknown IANA timezone').optional(),
  phone: z.string().trim().max(24).nullable().optional(),
  title: z.string().trim().max(120).nullable().optional(),
  department: z.string().trim().max(120).nullable().optional(),
  seniority: z.enum(['JUNIOR', 'MID', 'SENIOR', 'STAFF', 'PRINCIPAL']).optional(),
  yearsExperience: z.coerce.number().min(0).max(60).optional(),
  bioText: z.string().trim().max(1000).nullable().optional(),
  isActive: z.boolean().optional(),
  autoAcceptEnabled: z.boolean().optional(),
  interviewTypes: z.array(z.enum(INTERVIEW_TYPE_VALUES)).min(1).max(5).optional(),
  workingHours: z
    .object({
      startMinute: z.coerce.number().int().min(0).max(1439),
      endMinute: z.coerce.number().int().min(1).max(1440),
      weekdays: z.array(z.coerce.number().int().min(1).max(7)).min(1).max(7),
    })
    .optional(),
  limits: z
    .object({
      maxInterviewsPerDay: z.coerce.number().int().min(1).max(10),
      maxInterviewsPerWeek: z.coerce.number().int().min(1).max(40),
    })
    .optional(),
  skills: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        proficiency: z.coerce.number().int().min(1).max(5).default(3),
        yearsExperience: z.coerce.number().min(0).max(50).default(0),
      })
    )
    .max(60)
    .optional(),
});

router.put(
  '/:id',
  meAlias,
  requireInterviewerAccess(),
  validateBody(updateSchema),
  asyncHandler(async (req, res) => {
    if (req.body.workingHours && req.body.workingHours.endMinute <= req.body.workingHours.startMinute) {
      throw badRequest('Working hours must end after they start');
    }
    if (req.body.limits && req.body.limits.maxInterviewsPerWeek < req.body.limits.maxInterviewsPerDay) {
      throw badRequest('Weekly interview limit cannot be lower than the daily limit');
    }
    const updated = await updateInterviewer(req.params.id, req.body);
    await auditFromRequest(req, {
      action: 'INTERVIEWER_UPDATED',
      entity: 'InterviewerProfile',
      entityId: req.params.id,
      summary: `${updated.name} profile updated`,
    });
    res.json(updated);
  })
);

router.get(
  '/:id/availability',
  meAlias,
  asyncHandler(async (req, res) => {
    const profile = await prisma.interviewerProfile.findUnique({ where: { id: req.params.id } });
    if (!profile) throw notFound('Interviewer not found');
    res.json(await listAvailability(profile.userId, req.query));
  })
);

router.post(
  '/:id/availability',
  meAlias,
  requireInterviewerAccess(),
  validateBody(
    z.object({
      windows: z
        .array(
          z.object({
            startUtc: z.string().datetime({ offset: true }),
            endUtc: z.string().datetime({ offset: true }),
            kind: z.enum(AVAILABILITY_KIND_VALUES).default('AVAILABLE'),
            note: z.string().max(200).optional(),
          })
        )
        .min(1)
        .max(100),
      mode: z.enum(['append', 'replace']).default('append'),
    })
  ),
  asyncHandler(async (req, res) => {
    const profile = await prisma.interviewerProfile.findUnique({
      where: { id: req.params.id },
      include: { user: true },
    });
    if (!profile) throw notFound('Interviewer not found');
    const rows = await setAvailability(profile.userId, req.body.windows, {
      mode: req.body.mode,
      timezone: profile.user.timezone,
    });
    await auditFromRequest(req, {
      action: AUDIT_ACTIONS.AVAILABILITY_UPDATED,
      entity: 'InterviewerProfile',
      entityId: req.params.id,
      summary: `Availability updated (${rows.length} windows)`,
    });
    res.status(201).json(rows);
  })
);

router.delete(
  '/:id/availability/:windowId',
  meAlias,
  requireInterviewerAccess(),
  asyncHandler(async (req, res) => {
    const profile = await prisma.interviewerProfile.findUnique({ where: { id: req.params.id } });
    if (!profile) throw notFound('Interviewer not found');
    res.json(await deleteAvailabilityWindow(profile.userId, req.params.windowId));
  })
);

router.get(
  '/:id/workload',
  meAlias,
  asyncHandler(async (req, res) => {
    res.json(await computeWorkload(req.params.id, { days: Number(req.query.days) || 7 }));
  })
);

router.get(
  '/:id/interviews',
  meAlias,
  requireInterviewerAccess(),
  asyncHandler(async (req, res) => {
    const seats = await interviewerAssignments(req.params.id, { upcomingOnly: req.query.upcoming === 'true' });
    const profile = await prisma.interviewerProfile.findUnique({
      where: { id: req.params.id },
      include: { user: { select: { timezone: true } } },
    });
    res.json(
      seats.map((seat) => ({
        ...shapeInterview(seat.interview, {
          viewerTimezone: profile?.user?.timezone,
          viewerRole: ROLES.INTERVIEWER,
          includeFeedback: true,
        }),
        mySeat: {
          id: seat.id,
          role: seat.role,
          responseStatus: seat.responseStatus,
          matchScore: seat.matchScore,
          hasSubmittedFeedback: (seat.interview.feedback || []).some((f) => f.interviewerId === req.params.id),
        },
      }))
    );
  })
);

export default router;
