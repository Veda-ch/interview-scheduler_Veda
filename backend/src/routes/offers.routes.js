/**
 * Slot offers - "will you take one of these times?"
 *
 * Raised only when no interviewer had declared themselves free for any time the
 * candidate proposed. The interviewer either picks one of those times or
 * declines; silence for twelve hours passes the offer to the next-ranked
 * interviewer (see the monitor job).
 */
import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole, loadOwnProfile } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { idempotency } from '../middleware/idempotency.js';
import { forbidden, notFound } from '../lib/errors.js';
import { ROLES, OFFER_STATUS } from '../../../shared/constants.js';
import { respondToOffer, shapeOffer, expireStaleOffers } from '../services/autoSchedule.service.js';

const router = Router();
router.use(requireAuth);

const offerInclude = {
  request: {
    include: {
      application: {
        include: { job: true, candidate: { include: { user: { select: { name: true, timezone: true } } } } },
      },
    },
  },
  interviewer: { include: { user: { select: { name: true, timezone: true } } } },
};

/** Offers waiting on the signed-in interviewer. */
router.get(
  '/mine',
  requireRole(ROLES.INTERVIEWER),
  asyncHandler(async (req, res) => {
    const own = await loadOwnProfile(req);
    if (!own) throw forbidden('No interviewer profile');

    const rows = await prisma.slotOffer.findMany({
      where: { interviewerId: own.id, status: OFFER_STATUS.PENDING, expiresAt: { gt: new Date() } },
      include: offerInclude,
      orderBy: { createdAt: 'asc' },
    });
    res.json(rows.map((o) => shapeOffer(o, o.interviewer.user.timezone || 'UTC')));
  })
);

/** Every offer raised for one round - the recruiter's audit view. */
router.get(
  '/request/:requestId',
  requireRole(ROLES.RECRUITER, ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const rows = await prisma.slotOffer.findMany({
      where: { requestId: req.params.requestId },
      include: offerInclude,
      orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(
      rows.map((o) => ({
        ...shapeOffer(o, o.interviewer.user.timezone || 'UTC'),
        interviewerName: o.interviewer.user.name,
      }))
    );
  })
);

/** Accept one of the offered times. */
router.post(
  '/:id/accept',
  requireRole(ROLES.INTERVIEWER),
  idempotency(),
  validateBody(
    z.object({
      startUtc: z.string().datetime({ offset: true }),
      endUtc: z.string().datetime({ offset: true }),
    })
  ),
  asyncHandler(async (req, res) => {
    const own = await loadOwnProfile(req);
    if (!own) throw forbidden('No interviewer profile');
    const result = await respondToOffer({
      offerId: req.params.id,
      interviewerId: own.id,
      action: 'ACCEPT',
      startUtc: req.body.startUtc,
      endUtc: req.body.endUtc,
      actor: req.user,
    });
    res.status(201).json(result);
  })
);

/** Decline, and let it pass to the next interviewer. */
router.post(
  '/:id/decline',
  requireRole(ROLES.INTERVIEWER),
  idempotency(),
  validateBody(z.object({ reason: z.string().trim().min(3).max(500) })),
  asyncHandler(async (req, res) => {
    const own = await loadOwnProfile(req);
    if (!own) throw forbidden('No interviewer profile');
    const result = await respondToOffer({
      offerId: req.params.id,
      interviewerId: own.id,
      action: 'DECLINE',
      reason: req.body.reason,
      actor: req.user,
    });
    res.json(result);
  })
);

/** Force the expiry sweep - the monitor does this on a timer. */
router.post(
  '/expire-stale',
  requireRole(ROLES.RECRUITER, ROLES.ADMIN),
  asyncHandler(async (_req, res) => res.json(await expireStaleOffers()))
);

export default router;
