import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole, authorizeInterview, loadOwnProfile } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { candidateCancel, candidateReschedule } from '../services/autoSchedule.service.js';
import { idempotency } from '../middleware/idempotency.js';
import {
  candidateRespond,
  panelRespond,
  cancelInterview,
  rescheduleInterview,
  startInterview,
  completeInterview,
  getInterview,
  computeAndStoreHealth,
} from '../services/orchestration.service.js';
import { submitFeedback, getFeedbackForInterview } from '../services/feedback.service.js';
import { interviewTimeline } from '../services/audit.service.js';
import { shapeInterview, fullInterviewInclude } from '../services/interview.shape.js';
import { forbidden, badRequest, notFound } from '../lib/errors.js';
import {
  ROLES,
  CANDIDATE_RESPONSE,
  PANEL_RESPONSE,
  INTERVIEW_STATUS,
  INTERVIEW_STATUS_VALUES,
  RECOMMENDATION_VALUES,
} from '../../../shared/constants.js';

const router = Router();
router.use(requireAuth);

/** List interviews, automatically scoped to what the caller is allowed to see. */
router.get(
  '/',
  validateQuery(
    z.object({
      status: z.enum(INTERVIEW_STATUS_VALUES).optional(),
      from: z.string().datetime({ offset: true }).optional(),
      to: z.string().datetime({ offset: true }).optional(),
      jobId: z.string().optional(),
      candidateId: z.string().optional(),
      take: z.coerce.number().min(1).max(500).default(200),
    })
  ),
  asyncHandler(async (req, res) => {
    const q = req.validatedQuery;
    const where = {};
    if (q.status) where.status = q.status;
    if (q.from || q.to) {
      where.startUtc = {};
      if (q.from) where.startUtc.gte = new Date(q.from);
      if (q.to) where.startUtc.lte = new Date(q.to);
    }
    if (q.jobId) where.request = { application: { jobId: q.jobId } };
    if (q.candidateId) where.request = { ...(where.request || {}), application: { ...(where.request?.application || {}), candidateId: q.candidateId } };

    const own = await loadOwnProfile(req);
    if (req.user.role === ROLES.CANDIDATE) {
      if (!own) throw forbidden('No candidate profile');
      where.request = { application: { candidateId: own.id } };
    } else if (req.user.role === ROLES.INTERVIEWER) {
      if (!own) throw forbidden('No interviewer profile');
      where.panel = { some: { interviewerId: own.id } };
    }

    const rows = await prisma.interview.findMany({
      where,
      include: fullInterviewInclude,
      orderBy: { startUtc: 'asc' },
      take: q.take,
    });

    const viewer = await prisma.user.findUnique({ where: { id: req.user.id }, select: { timezone: true } });
    res.json(rows.map((r) => shapeInterview(r, { viewerTimezone: viewer?.timezone, viewerRole: req.user.role })));
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    await authorizeInterview(req, req.params.id, { action: 'view' });
    const viewer = await prisma.user.findUnique({ where: { id: req.user.id }, select: { timezone: true } });
    res.json(await getInterview(req.params.id, { timezone: viewer?.timezone, role: req.user.role }));
  })
);

router.get(
  '/:id/timeline',
  asyncHandler(async (req, res) => {
    await authorizeInterview(req, req.params.id, { action: 'view' });
    res.json(await interviewTimeline(req.params.id));
  })
);

router.get(
  '/:id/health',
  asyncHandler(async (req, res) => {
    await authorizeInterview(req, req.params.id, { action: 'view' });
    const existing = await prisma.scheduleScore.findFirst({
      where: { interviewId: req.params.id },
      orderBy: { computedAt: 'desc' },
    });
    // Recompute if stale (older than an hour) so the number reflects reality.
    if (!existing || Date.now() - existing.computedAt.getTime() > 3600_000) {
      const fresh = await computeAndStoreHealth(req.params.id);
      return res.json(fresh);
    }
    res.json(existing);
  })
);

// ------------------------------------------------------- candidate actions ---

const respondSchema = z.object({ note: z.string().trim().max(500).optional() });

router.post(
  '/:id/confirm',
  idempotency(),
  validateBody(respondSchema),
  asyncHandler(async (req, res) => {
    const interview = await authorizeInterview(req, req.params.id, { action: 'respond' });
    if (req.user.role !== ROLES.CANDIDATE && req.user.role !== ROLES.RECRUITER && req.user.role !== ROLES.ADMIN) {
      throw forbidden('Only the candidate or the recruiter can confirm this interview');
    }
    if (interview.startUtc < new Date()) throw badRequest('This interview has already started');

    res.json(
      await candidateRespond({
        interviewId: req.params.id,
        response: CANDIDATE_RESPONSE.ACCEPTED,
        note: req.body.note,
        actor: req.user,
      })
    );
  })
);

router.post(
  '/:id/decline',
  idempotency(),
  validateBody(z.object({ note: z.string().trim().min(3).max(500) })),
  asyncHandler(async (req, res) => {
    await authorizeInterview(req, req.params.id, { action: 'respond' });
    if (req.user.role !== ROLES.CANDIDATE && req.user.role !== ROLES.ADMIN) {
      throw forbidden('Only the candidate can decline their interview');
    }
    res.json(
      await candidateRespond({
        interviewId: req.params.id,
        response: CANDIDATE_RESPONSE.DECLINED,
        note: req.body.note,
        actor: req.user,
      })
    );
  })
);

router.post(
  '/:id/request-reschedule',
  idempotency(),
  validateBody(z.object({ note: z.string().trim().min(3).max(500) })),
  asyncHandler(async (req, res) => {
    const interview = await authorizeInterview(req, req.params.id, { action: 'respond' });
    if (interview.status === INTERVIEW_STATUS.CANCELLED) {
      throw badRequest('This interview is already cancelled - ask your recruiter to open a new round');
    }
    res.json(
      await candidateRespond({
        interviewId: req.params.id,
        response: CANDIDATE_RESPONSE.RESCHEDULE_REQUESTED,
        note: req.body.note,
        actor: req.user,
      })
    );
  })
);

// ----------------------------------------------------- interviewer actions ---

router.post(
  '/:id/accept',
  idempotency(),
  asyncHandler(async (req, res) => {
    await authorizeInterview(req, req.params.id, { action: 'respond' });
    const own = await loadOwnProfile(req);
    if (req.user.role !== ROLES.INTERVIEWER || !own) throw forbidden('Only a panel interviewer can accept');
    res.json(
      await panelRespond({
        interviewId: req.params.id,
        interviewerId: own.id,
        response: PANEL_RESPONSE.ACCEPTED,
        actor: req.user,
      })
    );
  })
);

router.post(
  '/:id/decline-assignment',
  idempotency(),
  validateBody(z.object({ reason: z.string().trim().min(3).max(500) })),
  asyncHandler(async (req, res) => {
    await authorizeInterview(req, req.params.id, { action: 'respond' });
    const own = await loadOwnProfile(req);
    if (req.user.role !== ROLES.INTERVIEWER || !own) throw forbidden('Only a panel interviewer can decline an assignment');
    res.json(
      await panelRespond({
        interviewId: req.params.id,
        interviewerId: own.id,
        response: PANEL_RESPONSE.DECLINED,
        reason: req.body.reason,
        actor: req.user,
      })
    );
  })
);

/**
 * The candidate calls the whole round off. Unlike a reschedule this is
 * terminal: the interview is cancelled and the round closes with it.
 */
router.post(
  '/:id/candidate-cancel',
  idempotency(),
  validateBody(z.object({ reason: z.string().trim().min(3).max(500) })),
  asyncHandler(async (req, res) => {
    await authorizeInterview(req, req.params.id, { action: 'respond' });
    if (req.user.role !== ROLES.CANDIDATE) {
      throw forbidden('Only the candidate can cancel their own round this way');
    }
    res.json(await candidateCancel({ interviewId: req.params.id, reason: req.body.reason, actor: req.user }));
  })
);

/** Candidate moves a booked interview to another of the interviewer's free times. */
router.post(
  '/:id/candidate-reschedule',
  idempotency(),
  validateBody(
    z.object({
      startUtc: z.string().datetime({ offset: true }),
      endUtc: z.string().datetime({ offset: true }),
    })
  ),
  asyncHandler(async (req, res) => {
    await authorizeInterview(req, req.params.id, { action: 'respond' });
    if (req.user.role !== ROLES.CANDIDATE) {
      throw forbidden('Only the candidate can move their own interview this way');
    }
    res.json(
      await candidateReschedule({
        interviewId: req.params.id,
        startUtc: req.body.startUtc,
        endUtc: req.body.endUtc,
        actor: req.user,
      })
    );
  })
);

// -------------------------------------------------------- recruiter actions ---

router.post(
  '/:id/cancel',
  requireRole(ROLES.RECRUITER, ROLES.ADMIN),
  idempotency(),
  validateBody(z.object({ reason: z.string().trim().min(3).max(500) })),
  asyncHandler(async (req, res) => {
    await authorizeInterview(req, req.params.id, { action: 'cancel' });
    res.json(await cancelInterview({ interviewId: req.params.id, reason: req.body.reason, actor: req.user }));
  })
);

router.post(
  '/:id/reschedule',
  requireRole(ROLES.RECRUITER, ROLES.ADMIN),
  idempotency(),
  validateBody(
    z.object({
      startUtc: z.string().datetime({ offset: true }),
      endUtc: z.string().datetime({ offset: true }),
      interviewerIds: z.array(z.string()).max(5).optional(),
      reason: z.string().trim().max(500).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    await authorizeInterview(req, req.params.id, { action: 'reschedule' });
    res.json(await rescheduleInterview({ interviewId: req.params.id, ...req.body, actor: req.user }));
  })
);

router.post(
  '/:id/start',
  asyncHandler(async (req, res) => {
    await authorizeInterview(req, req.params.id, { action: 'respond' });
    if (req.user.role === ROLES.CANDIDATE) throw forbidden('Only an interviewer or recruiter can start the interview');
    res.json(await startInterview({ interviewId: req.params.id, actor: req.user }));
  })
);

router.post(
  '/:id/complete',
  validateBody(z.object({ outcome: z.enum([INTERVIEW_STATUS.COMPLETED, INTERVIEW_STATUS.NO_SHOW]).default(INTERVIEW_STATUS.COMPLETED) })),
  asyncHandler(async (req, res) => {
    await authorizeInterview(req, req.params.id, { action: 'respond' });
    if (req.user.role === ROLES.CANDIDATE) throw forbidden('Only an interviewer or recruiter can complete the interview');
    res.json(await completeInterview({ interviewId: req.params.id, actor: req.user, outcome: req.body.outcome }));
  })
);

// ------------------------------------------------------------------ join ----

/**
 * Join details. Deliberately time-gated: the link is only returned inside the
 * join window, so a leaked interview id cannot be used to lurk in a room.
 */
router.get(
  '/:id/join',
  asyncHandler(async (req, res) => {
    const interview = await authorizeInterview(req, req.params.id, { action: 'view' });
    const now = Date.now();
    const opensAt = new Date(interview.startUtc).getTime() - 15 * 60000;
    const closesAt = new Date(interview.endUtc).getTime() + 30 * 60000;

    if (![INTERVIEW_STATUS.SCHEDULED, INTERVIEW_STATUS.CONFIRMED, INTERVIEW_STATUS.IN_PROGRESS].includes(interview.status)) {
      throw badRequest(`This interview is ${interview.status.toLowerCase()} and cannot be joined`);
    }
    if (now < opensAt) {
      return res.status(425).json({
        error: {
          code: 'TOO_EARLY',
          message: 'The room opens 15 minutes before the interview starts.',
          details: { opensAt: new Date(opensAt).toISOString() },
        },
      });
    }
    if (now > closesAt) throw badRequest('The join window for this interview has closed');
    if (!interview.meeting || interview.meeting.status !== 'ACTIVE') {
      throw notFound('No active meeting link exists for this interview yet. The Control Tower is regenerating it.');
    }

    res.json({
      joinUrl: interview.meeting.joinUrl,
      provider: interview.meeting.provider,
      passcode: interview.meeting.passcode,
      roomName: interview.meeting.externalId,
      embeddable: interview.meeting.provider === 'JITSI',
      displayName: req.user.name,
      endsAt: interview.endUtc,
    });
  })
);

// -------------------------------------------------------------- feedback ----

router.get(
  '/:id/feedback',
  asyncHandler(async (req, res) => {
    const interview = await authorizeInterview(req, req.params.id, { action: 'view' });
    if (req.user.role === ROLES.CANDIDATE) {
      // Candidates see that feedback exists, never its contents.
      return res.json({
        submitted: interview.feedback?.length ?? 0,
        expected: interview.panel.length,
        message: 'Interview feedback is confidential. Your recruiter will share the outcome.',
      });
    }
    res.json(await getFeedbackForInterview(req.params.id));
  })
);

router.post(
  '/:id/feedback',
  idempotency(),
  validateBody(
    z.object({
      overallRating: z.coerce.number().int().min(1).max(5),
      recommendation: z.enum(RECOMMENDATION_VALUES),
      ratings: z.record(z.string().max(60), z.coerce.number().min(1).max(5)).default({}),
      comments: z.string().trim().min(10).max(5000),
    })
  ),
  asyncHandler(async (req, res) => {
    await authorizeInterview(req, req.params.id, { action: 'respond' });
    const own = await loadOwnProfile(req);
    if (req.user.role !== ROLES.INTERVIEWER || !own) throw forbidden('Only a panel interviewer can submit feedback');

    const result = await submitFeedback({
      interviewId: req.params.id,
      interviewerId: own.id,
      payload: req.body,
      actor: req.user,
    });
    res.status(201).json(result);
  })
);

export default router;
