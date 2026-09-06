import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { idempotency } from '../middleware/idempotency.js';
import {
  controlTowerSnapshot,
  listIncidents,
  getIncident,
  raiseIncident,
  processIncident,
  applyRecoveryPlan,
  approveIncidentRecovery,
  dismissIncident,
  autonomyPolicyView,
  analyzeImpact,
} from '../services/controlTower.service.js';
import { runMonitorTick, monitorStats } from '../jobs/monitor.js';
import prisma from '../lib/prisma.js';
import { fullInterviewInclude } from '../services/interview.shape.js';
import { notFound } from '../lib/errors.js';
import {
  ROLES,
  INCIDENT_TYPE_VALUES,
  SEVERITY,
  INCIDENT_STATUS,
} from '../../../shared/constants.js';

const router = Router();
router.use(requireAuth, requireRole(ROLES.RECRUITER, ROLES.ADMIN));

/** The main Control Tower dashboard payload. */
router.get('/', asyncHandler(async (_req, res) => res.json(await controlTowerSnapshot())));

router.get(
  '/incidents',
  validateQuery(
    z.object({
      status: z.enum(Object.values(INCIDENT_STATUS)).optional(),
      severity: z.enum(Object.values(SEVERITY)).optional(),
      includeResolved: z.coerce.boolean().default(false),
      take: z.coerce.number().min(1).max(200).default(50),
    })
  ),
  asyncHandler(async (req, res) => res.json(await listIncidents(req.validatedQuery)))
);

router.get('/incidents/:id', asyncHandler(async (req, res) => res.json(await getIncident(req.params.id))));

/** Impact analysis on demand (also shown inline on the incident card). */
router.get(
  '/incidents/:id/impact',
  asyncHandler(async (req, res) => {
    const incident = await prisma.incident.findUnique({ where: { id: req.params.id } });
    if (!incident) throw notFound('Incident not found');
    const interview = incident.interviewId
      ? await prisma.interview.findUnique({ where: { id: incident.interviewId }, include: fullInterviewInclude })
      : null;
    res.json(await analyzeImpact(interview));
  })
);

/** Re-run planning for an incident (e.g. after availability changed). */
router.post(
  '/incidents/:id/recover',
  idempotency(),
  asyncHandler(async (req, res) => {
    res.json(await processIncident(req.params.id));
  })
);

/** Approve a plan that exceeded the autonomy ceiling. */
router.post(
  '/incidents/:id/approve',
  idempotency(),
  validateBody(z.object({ planId: z.string().optional() })),
  asyncHandler(async (req, res) => {
    res.json(await approveIncidentRecovery({ incidentId: req.params.id, planId: req.body.planId, actor: req.user }));
  })
);

/** Apply a specific (possibly non-recommended) plan. */
router.post(
  '/incidents/:id/apply',
  idempotency(),
  validateBody(z.object({ planId: z.string().min(5) })),
  asyncHandler(async (req, res) => {
    res.json(await applyRecoveryPlan({ incidentId: req.params.id, planId: req.body.planId, actor: req.user, automatic: false }));
  })
);

router.post(
  '/incidents/:id/dismiss',
  validateBody(z.object({ reason: z.string().trim().max(300).optional() })),
  asyncHandler(async (req, res) => {
    res.json(await dismissIncident({ incidentId: req.params.id, reason: req.body.reason, actor: req.user }));
  })
);

/**
 * Manually raise an incident. This is also the demo hook: it lets a presenter
 * inject "interviewer X just became unavailable" and watch the whole
 * detect -> analyse -> recover -> notify -> audit pipeline run live.
 */
router.post(
  '/incidents',
  validateBody(
    z.object({
      interviewId: z.string().optional(),
      type: z.enum(INTERVIEW_INCIDENT_TYPES()),
      severity: z.enum(Object.values(SEVERITY)).default(SEVERITY.MEDIUM),
      title: z.string().trim().min(3).max(160).optional(),
      description: z.string().trim().max(1000).optional(),
      context: z.record(z.string(), z.any()).default({}),
      autoRecover: z.boolean().default(true),
    })
  ),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const incident = await raiseIncident({
      interviewId: b.interviewId ?? null,
      type: b.type,
      severity: b.severity,
      title: b.title || `Manually reported: ${b.type}`,
      description: b.description || `Raised by ${req.user.name} from the Control Tower.`,
      detectedBy: 'USER',
      context: b.context,
      bucket: `manual-${Date.now()}`,
      autoRecover: b.autoRecover,
    });
    res.status(201).json(await getIncident(incident.id));
  })
);

/** The autonomy policy table - what the system may and may not do alone. */
router.get('/policy', asyncHandler(async (_req, res) => res.json(await autonomyPolicyView())));

/** Monitor status + a manual tick, so a demo need not wait for the interval. */
router.get('/monitor', (_req, res) => res.json(monitorStats()));

router.post(
  '/monitor/run',
  asyncHandler(async (_req, res) => {
    const stats = await runMonitorTick();
    res.json({ ok: true, stats: { ...stats, ...monitorStats() } });
  })
);

/** Enumerate the incident types the UI can offer. */
function INTERVIEW_INCIDENT_TYPES() {
  return INCIDENT_TYPE_VALUES;
}

router.get('/incident-types', (_req, res) =>
  res.json(
    INCIDENT_TYPE_VALUES.map((type) => ({
      type,
      label: type
        .toLowerCase()
        .split('_')
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(' '),
    }))
  )
);

export default router;
