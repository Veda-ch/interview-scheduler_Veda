/**
 * Demo data reset.
 *
 * Rebuilds the entire seeded dataset in-process so a walkthrough can be re-run
 * without dropping to a terminal. Destructive by design: every table the seed
 * owns is emptied first, users and refresh tokens included, so the caller's own
 * session is invalid afterwards and the client must send them back to login.
 */
import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRecruiter } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import logger from '../lib/logger.js';
import { seedDemo } from '../../../prisma/seed.js';

const router = Router();

router.post(
  '/reset',
  requireAuth,
  requireRecruiter,
  asyncHandler(async (req, res) => {
    logger.warn('Demo data reset requested', { by: req.user?.email });

    // Reuse the process-wide client: a second PrismaClient against the same
    // SQLite file would contend for the write lock with the live server.
    const summary = await seedDemo({
      client: prisma,
      log: (line) => logger.info(String(line).trim()),
    });

    logger.warn('Demo data reset complete');
    res.json({
      ok: true,
      summary,
      // The caller's user row no longer exists; say so explicitly rather than
      // letting the next request fail with a confusing 401.
      sessionInvalidated: true,
      message: 'Demo data rebuilt. All sessions were cleared - sign in again.',
    });
  })
);

export default router;
