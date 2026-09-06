import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  overviewMetrics,
  interviewTrend,
  interviewerUtilization,
  pipelineFunnel,
  healthDistribution,
} from '../services/analytics.service.js';
import { ROLES } from '../../../shared/constants.js';

const router = Router();
router.use(requireAuth, requireRole(ROLES.RECRUITER, ROLES.ADMIN));

const windowSchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

router.get(
  '/overview',
  validateQuery(windowSchema),
  asyncHandler(async (req, res) => res.json(await overviewMetrics(req.validatedQuery)))
);

router.get(
  '/trend',
  validateQuery(windowSchema),
  asyncHandler(async (req, res) => res.json(await interviewTrend(req.validatedQuery)))
);

router.get(
  '/interviewer-utilization',
  asyncHandler(async (_req, res) => res.json(await interviewerUtilization()))
);

router.get('/funnel', asyncHandler(async (_req, res) => res.json(await pipelineFunnel())));

router.get('/health-distribution', asyncHandler(async (_req, res) => res.json(await healthDistribution())));

export default router;
