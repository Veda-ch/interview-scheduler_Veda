/**
 * Health + capability discovery.
 *
 * `/api/health` is also how the UI learns which subsystems are in DEMO MODE, so
 * the app can be honest on screen about what is real and what is mocked.
 */
import { Router } from 'express';
import config from '../config/env.js';
import { checkDatabase } from '../lib/prisma.js';
import { aiServiceHealth } from '../providers/aiClient.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();
const startedAt = Date.now();

router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const [db, ai] = await Promise.all([checkDatabase(), aiServiceHealth()]);

    const degraded = !ai.ok; // the app still schedules via the JS fallback
    res.status(db.ok ? 200 : 503).json({
      status: !db.ok ? 'down' : degraded ? 'degraded' : 'ok',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      version: '1.0.0',
      environment: config.env,
      demoMode: config.demoMode,
      services: {
        api: { ok: true },
        database: db,
        aiService: {
          ok: ai.ok,
          url: config.aiService.url,
          latencyMs: ai.latencyMs,
          provider: ai.ai_provider,
          embeddingProvider: ai.embedding_provider,
          solver: ai.solver,
          breaker: ai.breaker,
          error: ai.error,
          note: ai.ok ? undefined : 'Scheduling continues on the deterministic JS fallback engine.',
        },
      },
      providers: {
        ai: config.providers.ai,
        calendar: config.providers.calendar,
        meeting: config.providers.meeting,
        notification: config.providers.notification,
        googleConfigured: config.google.configured,
        smtpConfigured: config.smtp.configured,
        smsConfigured: config.twilio.configured,
      },
      policy: {
        defaultBufferMinutes: config.scheduling.defaultBufferMinutes,
        slotGranularityMinutes: config.scheduling.slotGranularityMinutes,
        autonomyMaxRisk: config.scheduling.autonomyMaxRisk,
        simulationIterations: config.scheduling.simulationIterations,
      },
    });
  })
);

/** Lightweight liveness probe for container orchestrators. */
router.get('/health/live', (_req, res) => res.json({ ok: true }));

export default router;
