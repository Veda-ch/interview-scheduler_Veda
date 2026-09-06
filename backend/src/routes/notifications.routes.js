import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { listNotifications, markRead, markAllRead, notify } from '../services/notification.service.js';
import { ROLES, NOTIFICATION_TYPES } from '../../../shared/constants.js';
import { notFound } from '../lib/errors.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  validateQuery(
    z.object({
      unreadOnly: z.coerce.boolean().default(false),
      take: z.coerce.number().min(1).max(200).default(50),
    })
  ),
  asyncHandler(async (req, res) => {
    const items = await listNotifications(req.user.id, req.validatedQuery);
    const unread = await prisma.notification.count({
      where: { userId: req.user.id, channel: 'IN_APP', readAt: null },
    });
    res.json({ items, unread });
  })
);

router.post(
  '/read',
  validateBody(z.object({ ids: z.array(z.string()).min(1).max(200) })),
  asyncHandler(async (req, res) => res.json(await markRead(req.user.id, req.body.ids)))
);

router.post('/read-all', asyncHandler(async (req, res) => res.json(await markAllRead(req.user.id))));

/** Manual send - recruiters only, used for ad-hoc candidate communication. */
router.post(
  '/send',
  requireRole(ROLES.RECRUITER, ROLES.ADMIN),
  validateBody(
    z.object({
      userId: z.string().min(5),
      type: z.enum(Object.values(NOTIFICATION_TYPES)).default(NOTIFICATION_TYPES.INTERVIEW_REMINDER),
      context: z.record(z.string(), z.any()).default({}),
      channels: z.array(z.enum(['IN_APP', 'EMAIL', 'SMS'])).default(['IN_APP', 'EMAIL']),
      personalize: z.boolean().default(false),
    })
  ),
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.body.userId } });
    if (!target) throw notFound('Recipient not found');
    res.status(201).json(await notify(req.body));
  })
);

export default router;
