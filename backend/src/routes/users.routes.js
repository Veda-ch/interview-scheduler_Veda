import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { publicUser } from '../services/auth.service.js';
import { listSkills, skillsWithUsage } from '../services/skill.service.js';
import { isValidZone } from '../lib/time.js';
import { ROLES, ROLE_VALUES } from '../../../shared/constants.js';
import { notFound } from '../lib/errors.js';

const router = Router();
router.use(requireAuth);

/** Update your own account settings (name, timezone, phone). */
router.put(
  '/me',
  validateBody(
    z.object({
      name: z.string().trim().min(2).max(80).optional(),
      timezone: z.string().refine(isValidZone, 'Unknown IANA timezone').optional(),
      phone: z.string().trim().max(24).nullable().optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.update({ where: { id: req.user.id }, data: req.body });
    res.json(publicUser(user));
  })
);

/** Directory - recruiters and admins only. */
router.get(
  '/',
  requireRole(ROLES.RECRUITER, ROLES.ADMIN),
  validateQuery(
    z.object({
      role: z.enum(ROLE_VALUES).optional(),
      search: z.string().trim().max(80).optional(),
      take: z.coerce.number().min(1).max(200).default(100),
    })
  ),
  asyncHandler(async (req, res) => {
    const { role, search, take } = req.validatedQuery;
    const rows = await prisma.user.findMany({
      where: {
        ...(role ? { role } : {}),
        ...(search ? { OR: [{ name: { contains: search } }, { email: { contains: search } }] } : {}),
      },
      orderBy: { name: 'asc' },
      take,
    });
    res.json(rows.map(publicUser));
  })
);

router.get(
  '/timezones',
  asyncHandler(async (_req, res) => {
    // A curated list keeps the picker usable; any valid IANA zone is accepted.
    res.json([
      'UTC', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Dubai', 'Asia/Shanghai',
      'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Warsaw', 'Europe/Dublin',
      'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo',
      'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland', 'Africa/Nairobi', 'Africa/Lagos',
    ]);
  })
);

router.get(
  '/skills',
  asyncHandler(async (req, res) => res.json(await listSkills({ search: req.query.search })))
);

router.get(
  '/skills/usage',
  requireRole(ROLES.RECRUITER, ROLES.ADMIN),
  asyncHandler(async (_req, res) => res.json(await skillsWithUsage()))
);

router.get(
  '/:id',
  requireRole(ROLES.RECRUITER, ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw notFound('User not found');
    res.json(publicUser(user));
  })
);

export default router;
