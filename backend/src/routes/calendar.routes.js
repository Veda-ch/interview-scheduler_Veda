import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import config from '../config/env.js';
import { requireAuth, authorizeInterview } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  getCalendarProvider,
  GoogleCalendarProvider,
  createEventSafely,
  cancelEventSafely,
} from '../providers/calendar.provider.js';
import { encryptSecret } from '../lib/crypto.js';
import { auditFromRequest } from '../services/audit.service.js';
import { badRequest, notFound } from '../lib/errors.js';

const router = Router();

/** Provider status - drives the "Connect Google Calendar" button state. */
router.get('/provider', requireAuth, (_req, res) => {
  const provider = getCalendarProvider();
  res.json({
    provider: provider.name,
    googleConfigured: config.google.configured,
    canConnect: config.google.configured && provider.name === 'GOOGLE',
    note:
      provider.name === 'MOCK'
        ? 'Demo mode: availability is read from this application’s own booking store instead of an external calendar. Set CALENDAR_PROVIDER=google with OAuth credentials to use Google Calendar.'
        : 'Connected to Google Calendar via OAuth 2.0.',
  });
});

/** Start the OAuth flow. State is a signed, short-lived token bound to the user. */
router.post(
  '/connect',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!config.google.configured) {
      throw badRequest(
        'Google Calendar is not configured on this deployment. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the environment.'
      );
    }
    const nonce = crypto.randomBytes(16).toString('hex');
    const state = Buffer.from(JSON.stringify({ userId: req.user.id, nonce, ts: Date.now() })).toString('base64url');
    res.json({ authUrl: GoogleCalendarProvider.authUrl(state), expiresInSeconds: 600 });
  })
);

/** OAuth callback. Public by necessity; the state carries the user binding. */
router.get(
  '/oauth/callback',
  validateQuery(z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const { code, state, error } = req.validatedQuery;
    if (error) return res.status(400).send(`Calendar connection cancelled: ${error}`);
    if (!code || !state) throw badRequest('Missing OAuth code or state');

    let parsed;
    try {
      parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    } catch {
      throw badRequest('Invalid OAuth state');
    }
    if (!parsed.userId || Date.now() - parsed.ts > 600_000) throw badRequest('OAuth state expired');

    const tokens = await GoogleCalendarProvider.exchangeCode(code);

    await prisma.calendarConnection.upsert({
      where: { userId_provider: { userId: parsed.userId, provider: 'GOOGLE' } },
      update: {
        accessToken: encryptSecret(tokens.access_token),
        ...(tokens.refresh_token ? { refreshToken: encryptSecret(tokens.refresh_token) } : {}),
        expiresAt: new Date(Date.now() + (tokens.expires_in || 3600) * 1000),
        scope: tokens.scope,
        status: 'CONNECTED',
      },
      create: {
        userId: parsed.userId,
        provider: 'GOOGLE',
        accessToken: encryptSecret(tokens.access_token),
        refreshToken: encryptSecret(tokens.refresh_token),
        expiresAt: new Date(Date.now() + (tokens.expires_in || 3600) * 1000),
        scope: tokens.scope,
      },
    });

    res.send(
      '<html><body style="font-family:system-ui;padding:40px"><h2>Calendar connected</h2>' +
        '<p>You can close this window and return to the scheduler.</p></body></html>'
    );
  })
);

router.get(
  '/connection',
  requireAuth,
  asyncHandler(async (req, res) => {
    const link = await prisma.calendarConnection.findFirst({ where: { userId: req.user.id } });
    res.json(
      link
        ? { connected: link.status === 'CONNECTED', provider: link.provider, status: link.status, expiresAt: link.expiresAt }
        : { connected: false, provider: getCalendarProvider().name }
    );
  })
);

router.delete(
  '/connection',
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.calendarConnection.deleteMany({ where: { userId: req.user.id } });
    res.json({ ok: true });
  })
);

/** Busy windows for the caller (or, for recruiters, any user they name). */
router.get(
  '/availability',
  requireAuth,
  validateQuery(
    z.object({
      userId: z.string().optional(),
      from: z.string().datetime({ offset: true }),
      to: z.string().datetime({ offset: true }),
    })
  ),
  asyncHandler(async (req, res) => {
    const { userId, from, to } = req.validatedQuery;
    const targetId = userId && ['RECRUITER', 'ADMIN'].includes(req.user.role) ? userId : req.user.id;
    const busy = await getCalendarProvider().getBusyWindows(targetId, new Date(from), new Date(to));
    res.json({ userId: targetId, provider: getCalendarProvider().name, busy });
  })
);

/** Manual event creation/cancellation for an interview (repair path). */
router.post(
  '/events',
  requireAuth,
  validateBody(z.object({ interviewId: z.string().min(5) })),
  asyncHandler(async (req, res) => {
    const interview = await authorizeInterview(req, req.body.interviewId, { action: 'reschedule' });
    const app = interview.request.application;

    const { ok, result, error } = await createEventSafely({
      interviewId: interview.id,
      organizerUserId: app.job.recruiter?.userId ?? req.user.id,
      title: `${interview.request.roundName} - ${app.job.title} - ${app.candidate.user.name}`,
      description: 'Created manually from the scheduler.',
      startUtc: interview.startUtc,
      endUtc: interview.endUtc,
      attendees: [
        { email: app.candidate.user.email },
        ...interview.panel.map((p) => ({ email: p.interviewer.user.email })),
      ],
    });

    const record = await prisma.calendarEventRecord.upsert({
      where: { interviewId: interview.id },
      update: { externalId: result.externalId, status: ok ? 'CONFIRMED' : 'SYNC_FAILED', syncError: ok ? null : String(error).slice(0, 300), lastSyncedAt: new Date() },
      create: {
        interviewId: interview.id,
        provider: result.provider,
        externalId: result.externalId,
        status: ok ? 'CONFIRMED' : 'SYNC_FAILED',
        syncError: ok ? null : String(error).slice(0, 300),
      },
    });

    await auditFromRequest(req, {
      action: 'CALENDAR_EVENT_CREATED',
      entity: 'Interview',
      entityId: interview.id,
      summary: ok ? 'Calendar event created manually' : `Manual calendar sync failed: ${error}`,
    });

    res.status(ok ? 201 : 502).json({ ok, record, error });
  })
);

router.delete(
  '/events/:interviewId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const interview = await authorizeInterview(req, req.params.interviewId, { action: 'reschedule' });
    const record = await prisma.calendarEventRecord.findUnique({ where: { interviewId: interview.id } });
    if (!record) throw notFound('No calendar event for this interview');

    const result = await cancelEventSafely(record.externalId, {
      organizerUserId: interview.request.application.job.recruiter?.userId,
    });
    await prisma.calendarEventRecord.update({
      where: { interviewId: interview.id },
      data: { status: result.ok ? 'CANCELLED' : 'SYNC_FAILED', syncError: result.ok ? null : String(result.error).slice(0, 300) },
    });
    res.json(result);
  })
);

export default router;
