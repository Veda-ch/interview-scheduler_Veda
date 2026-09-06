import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { listAuditLogs } from '../services/audit.service.js';
import { ROLES, AUDIT_ACTIONS } from '../../../shared/constants.js';

const router = Router();
router.use(requireAuth, requireRole(ROLES.RECRUITER, ROLES.ADMIN));

router.get(
  '/',
  validateQuery(
    z.object({
      entity: z.string().max(40).optional(),
      entityId: z.string().max(60).optional(),
      actorUserId: z.string().max(60).optional(),
      action: z.string().max(60).optional(),
      take: z.coerce.number().min(1).max(500).default(100),
      skip: z.coerce.number().min(0).default(0),
    })
  ),
  asyncHandler(async (req, res) => res.json(await listAuditLogs(req.validatedQuery)))
);

router.get('/actions', (_req, res) => res.json(Object.values(AUDIT_ACTIONS)));

export default router;
