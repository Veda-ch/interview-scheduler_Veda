/**
 * Admin surface - deliberately small: users, policy settings, skills taxonomy
 * and system health. Everything an admin can do is audited like any other actor.
 */
import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import config from '../config/env.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { listSettings, updateSetting, DEFAULT_SETTINGS } from '../services/settings.service.js';
import { skillsWithUsage, upsertSkillsByName } from '../services/skill.service.js';
import { publicUser } from '../services/auth.service.js';
import { auditFromRequest } from '../services/audit.service.js';
import { checkDatabase } from '../lib/prisma.js';
import { aiServiceHealth } from '../providers/aiClient.js';
import { monitorStats } from '../jobs/monitor.js';
import { AUDIT_ACTIONS, ROLE_VALUES, SETTING_KEYS } from '../../../shared/constants.js';
import { notFound, badRequest } from '../lib/errors.js';

const router = Router();
router.use(requireAuth, requireAdmin);

// ------------------------------------------------------------------ users ---

router.get(
  '/users',
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      include: {
        candidateProfile: { select: { id: true } },
        interviewerProfile: { select: { id: true, isActive: true } },
        recruiterProfile: { select: { id: true } },
        _count: { select: { availability: true, bookings: true } },
      },
    });
    res.json(
      users.map((u) => ({
        ...publicUser(u),
        lastLoginAt: u.lastLoginAt,
        profileId: u.candidateProfile?.id || u.interviewerProfile?.id || u.recruiterProfile?.id || null,
        availabilityWindows: u._count.availability,
        bookings: u._count.bookings,
      }))
    );
  })
);

router.put(
  '/users/:id',
  validateBody(
    z.object({
      role: z.enum(ROLE_VALUES).optional(),
      isActive: z.boolean().optional(),
      name: z.string().trim().min(2).max(80).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw notFound('User not found');
    if (req.params.id === req.user.id && req.body.isActive === false) {
      throw badRequest('You cannot deactivate your own account');
    }
    if (req.body.role && req.body.role !== target.role) {
      // Changing role without the matching profile row would break the app.
      throw badRequest(
        'Role changes are not supported after registration because each role owns a different profile table. Create a new account instead.'
      );
    }

    const updated = await prisma.user.update({ where: { id: req.params.id }, data: req.body });

    // Deactivating a user must also stop them being scheduled.
    if (req.body.isActive === false) {
      await prisma.interviewerProfile.updateMany({ where: { userId: target.id }, data: { isActive: false } });
    }

    await auditFromRequest(req, {
      action: 'USER_UPDATED',
      entity: 'User',
      entityId: target.id,
      summary: `${target.name} updated by admin`,
      metadata: req.body,
    });
    res.json(publicUser(updated));
  })
);

// --------------------------------------------------------------- settings ---

router.get('/settings', asyncHandler(async (_req, res) => res.json(await listSettings())));

router.put(
  '/settings/:key',
  validateBody(z.object({ value: z.union([z.string(), z.number(), z.boolean()]) })),
  asyncHandler(async (req, res) => {
    const key = req.params.key;
    if (!DEFAULT_SETTINGS[key]) throw badRequest(`Unknown setting "${key}"`);

    // Guard rails so an admin cannot set a value that breaks scheduling.
    const numeric = Number(req.body.value);
    if (key === SETTING_KEYS.SLOT_GRANULARITY_MINUTES && (numeric < 5 || numeric > 120)) {
      throw badRequest('Slot granularity must be between 5 and 120 minutes');
    }
    if (key === SETTING_KEYS.DEFAULT_BUFFER_MINUTES && (numeric < 0 || numeric > 120)) {
      throw badRequest('Buffer must be between 0 and 120 minutes');
    }
    if (key === SETTING_KEYS.AUTONOMY_AUTO_APPLY_MAX_RISK && !['LOW', 'MEDIUM', 'HIGH'].includes(String(req.body.value).toUpperCase())) {
      throw badRequest('Autonomy ceiling must be LOW, MEDIUM or HIGH');
    }

    const updated = await updateSetting(key, req.body.value);
    await auditFromRequest(req, {
      action: AUDIT_ACTIONS.SETTING_UPDATED,
      entity: 'SystemSetting',
      entityId: key,
      summary: `${key} set to ${req.body.value}`,
    });
    res.json(updated);
  })
);

// ----------------------------------------------------------------- skills ---

router.get('/skills', asyncHandler(async (_req, res) => res.json(await skillsWithUsage())));

router.post(
  '/skills',
  validateBody(z.object({ names: z.array(z.string().trim().min(1).max(60)).min(1).max(50) })),
  asyncHandler(async (req, res) => {
    const map = await upsertSkillsByName(prisma, req.body.names);
    res.status(201).json([...map.values()]);
  })
);

router.delete(
  '/skills/:id',
  asyncHandler(async (req, res) => {
    const usage = await prisma.skill.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { candidateSkills: true, interviewerSkills: true } } },
    });
    if (!usage) throw notFound('Skill not found');
    if (usage._count.candidateSkills || usage._count.interviewerSkills) {
      throw badRequest('This skill is in use by candidates or interviewers and cannot be deleted');
    }
    await prisma.skill.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  })
);

// ----------------------------------------------------------------- health ---

router.get(
  '/system-health',
  asyncHandler(async (_req, res) => {
    const [db, ai, counts] = await Promise.all([
      checkDatabase(),
      aiServiceHealth(),
      Promise.all([
        prisma.user.count(),
        prisma.interview.count(),
        prisma.incident.count({ where: { status: { notIn: ['RESOLVED', 'DISMISSED'] } } }),
        prisma.notification.count({ where: { status: 'FAILED' } }),
        prisma.calendarEventRecord.count({ where: { status: 'SYNC_FAILED' } }),
        prisma.meeting.count({ where: { status: 'FAILED' } }),
        prisma.slotProposal.count({ where: { status: 'OPEN' } }),
      ]),
    ]);
    const [users, interviews, openIncidents, failedNotifications, failedCalendar, failedMeetings, openProposals] = counts;

    res.json({
      database: db,
      aiService: ai,
      monitor: monitorStats(),
      providers: config.providers,
      demoMode: config.demoMode,
      counts: { users, interviews, openIncidents, failedNotifications, failedCalendar, failedMeetings, openProposals },
      process: {
        nodeVersion: process.version,
        uptimeSeconds: Math.round(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      },
    });
  })
);

export default router;
