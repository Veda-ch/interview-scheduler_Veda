import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { authorizeInterview } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getMeetingProvider } from '../providers/meeting.provider.js';
import { attachMeetingAndCalendar } from '../services/orchestration.service.js';
import config from '../config/env.js';
import { notFound } from '../lib/errors.js';

const router = Router();
router.use(requireAuth);

/** Provider capability discovery for the UI (embed vs open in a new tab). */
router.get('/provider', (_req, res) => {
  const provider = getMeetingProvider();
  res.json({
    provider: provider.name,
    domain: config.jitsi.domain,
    embeddable: provider.name === 'JITSI',
    note:
      provider.name === 'JITSI'
        ? 'Jitsi rooms are created on first join and need no account or API key.'
        : 'This provider opens in a new tab.',
  });
});

router.get(
  '/:interviewId',
  asyncHandler(async (req, res) => {
    await authorizeInterview(req, req.params.interviewId, { action: 'view' });
    const meeting = await prisma.meeting.findUnique({ where: { interviewId: req.params.interviewId } });
    if (!meeting) throw notFound('No meeting exists for this interview yet');
    res.json(meeting);
  })
);

/** Regenerate a broken link (also available as an automatic recovery strategy). */
router.post(
  '/:interviewId/regenerate',
  asyncHandler(async (req, res) => {
    await authorizeInterview(req, req.params.interviewId, { action: 'reschedule' });
    await prisma.meeting.deleteMany({ where: { interviewId: req.params.interviewId } });
    await attachMeetingAndCalendar(req.params.interviewId);
    res.json(await prisma.meeting.findUnique({ where: { interviewId: req.params.interviewId } }));
  })
);

export default router;
