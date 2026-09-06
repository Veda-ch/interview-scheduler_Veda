/**
 * Express application assembly. Kept free of side effects (no listen, no
 * background jobs) so tests can import it directly with supertest.
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';

import config from './config/env.js';
import logger from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

import healthRoutes from './routes/health.routes.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/users.routes.js';
import candidateRoutes from './routes/candidates.routes.js';
import interviewerRoutes from './routes/interviewers.routes.js';
import jobRoutes from './routes/jobs.routes.js';
import requestRoutes from './routes/requests.routes.js';
import interviewRoutes from './routes/interviews.routes.js';
import schedulerRoutes from './routes/scheduler.routes.js';
import aiRoutes from './routes/ai.routes.js';
import controlTowerRoutes from './routes/controlTower.routes.js';
import calendarRoutes from './routes/calendar.routes.js';
import meetingRoutes from './routes/meetings.routes.js';
import notificationRoutes from './routes/notifications.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import auditRoutes from './routes/audit.routes.js';
import adminRoutes from './routes/admin.routes.js';
import offerRoutes from './routes/offers.routes.js';
import demoRoutes from './routes/demo.routes.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  // --- Security headers. crossOriginResourcePolicy relaxed so the SPA on :5173
  // can load resume downloads from :4000 during development.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: config.isProd ? undefined : false,
    })
  );

  app.use(
    cors({
      origin(origin, cb) {
        // same-origin / curl / server-to-server requests have no Origin header
        if (!origin || config.corsOrigin.includes(origin)) return cb(null, true);
        return cb(new Error('Origin not allowed by CORS policy'));
      },
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
      exposedHeaders: ['Idempotent-Replay'],
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  if (!config.isTest) {
    app.use(
      morgan('tiny', {
        stream: { write: (msg) => logger.debug(msg.trim()) },
        skip: (req) => req.path.startsWith('/api/health'),
      })
    );
  }

  // --- Rate limiting: a broad ceiling for the API, a tight one for auth.
  const apiLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => config.isTest,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
  });
  const authLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.authMax,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => config.isTest,
    message: {
      error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts. Try again in a minute.' },
    },
  });

  app.use('/api', apiLimiter);

  // Uploaded resumes are served read-only and never executed.
  app.use(
    '/uploads',
    express.static(config.upload.dir, {
      dotfiles: 'deny',
      index: false,
      setHeaders: (res) => {
        res.setHeader('Content-Disposition', 'attachment');
        res.setHeader('X-Content-Type-Options', 'nosniff');
      },
    })
  );

  app.use('/api', healthRoutes);
  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/candidates', candidateRoutes);
  app.use('/api/interviewers', interviewerRoutes);
  app.use('/api/jobs', jobRoutes);
  app.use('/api/interview-requests', requestRoutes);
  app.use('/api/interviews', interviewRoutes);
  app.use('/api/scheduler', schedulerRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/control-tower', controlTowerRoutes);
  app.use('/api/calendar', calendarRoutes);
  app.use('/api/meetings', meetingRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/audit-logs', auditRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/offers', offerRoutes);
  app.use('/api/demo', demoRoutes);

  app.get('/', (_req, res) =>
    res.json({
      name: 'Smart Interview Scheduler API',
      docs: '/api/health',
      demoMode: config.demoMode,
    })
  );

  // Serve the built SPA in production (single deployable unit).
  if (config.isProd) {
    const dist = path.join(config.repoRoot, 'frontend', 'dist');
    app.use(express.static(dist));
    app.get(/^\/(?!api|uploads).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
