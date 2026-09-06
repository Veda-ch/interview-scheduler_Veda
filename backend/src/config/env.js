/**
 * Central environment loader. Nothing else in the backend reads process.env
 * directly, so every secret has exactly one place it can come from and one
 * place it can be validated.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

// Root .env is the single source of truth for the whole monorepo.
dotenv.config({ path: path.join(repoRoot, '.env') });

const bool = (v, d = false) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const int = (v, d) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

/** Secrets must never be hardcoded; in production we refuse to boot on defaults. */
function requiredSecret(name, devDefault) {
  const value = process.env[name];
  if (value && value.length >= 16) return value;
  if (isProd) {
    throw new Error(
      `[config] ${name} is missing or too short. Set it in the environment (see .env.example).`
    );
  }
  return value || devDefault;
}

export const config = {
  repoRoot,
  env: process.env.NODE_ENV || 'development',
  isProd,
  isTest,
  port: int(process.env.PORT, 4000),
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  jwt: {
    accessSecret: requiredSecret('JWT_ACCESS_SECRET', 'dev-only-insecure-access-secret-000000'),
    refreshSecret: requiredSecret('JWT_REFRESH_SECRET', 'dev-only-insecure-refresh-secret-00000'),
    accessTtl: process.env.JWT_ACCESS_TTL || '30m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
  },
  bcryptRounds: int(process.env.BCRYPT_ROUNDS, isTest ? 4 : 10),

  rateLimit: {
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    max: int(process.env.RATE_LIMIT_MAX, 300),
    authMax: int(process.env.AUTH_RATE_LIMIT_MAX, 20),
  },

  upload: {
    dir: path.resolve(repoRoot, process.env.UPLOAD_DIR || './uploads'),
    maxBytes: int(process.env.MAX_UPLOAD_BYTES, 2 * 1024 * 1024),
    allowedExtensions: ['.pdf', '.txt', '.md', '.doc', '.docx'],
    allowedMime: [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
  },

  aiService: {
    url: process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000',
    timeoutMs: int(process.env.AI_SERVICE_TIMEOUT_MS, 20_000),
    token: process.env.AI_SERVICE_TOKEN || 'dev-shared-service-token',
  },

  providers: {
    calendar: (process.env.CALENDAR_PROVIDER || 'mock').toLowerCase(),
    meeting: (process.env.MEETING_PROVIDER || 'jitsi').toLowerCase(),
    notification: (process.env.NOTIFICATION_PROVIDER || 'mock').toLowerCase(),
    ai: (process.env.AI_PROVIDER || 'mock').toLowerCase(),
  },

  frontendUrl: (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, ''),
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:4000/api/calendar/oauth/callback',
    loginRedirectUri: process.env.GOOGLE_LOGIN_REDIRECT_URI || 'http://localhost:4000/api/auth/google/callback',
    get configured() {
      return Boolean(this.clientId && this.clientSecret);
    },
  },

  jitsi: { domain: process.env.JITSI_DOMAIN || 'meet.jit.si' },

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'Interview Control Tower <no-reply@scheduler.local>',
    get configured() {
      return Boolean(this.host && this.user);
    },
  },

  twilio: {
    sid: process.env.TWILIO_ACCOUNT_SID || '',
    token: process.env.TWILIO_AUTH_TOKEN || '',
    from: process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_FROM || '',
    get configured() {
      return Boolean(this.sid && this.token && this.from);
    },
  },

  scheduling: {
    defaultBufferMinutes: int(process.env.DEFAULT_BUFFER_MINUTES, 15),
    slotGranularityMinutes: int(process.env.SLOT_GRANULARITY_MINUTES, 30),
    autonomyMaxRisk: (process.env.AUTONOMY_AUTO_APPLY_MAX_RISK || 'LOW').toUpperCase(),
  },

  monitor: {
    enabled: bool(process.env.MONITOR_ENABLED, true) && !isTest,
    intervalMs: int(process.env.MONITOR_INTERVAL_MS, 60_000),
  },

  /** Used by the UI + /api/health to show exactly which mode each subsystem is in. */
  get demoMode() {
    return (
      this.providers.ai === 'mock' &&
      this.providers.calendar === 'mock' &&
      this.providers.notification === 'mock'
    );
  },
};

export default config;
