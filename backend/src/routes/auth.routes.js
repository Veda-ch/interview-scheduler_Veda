import { Router } from 'express';
import { z } from 'zod';
import {
  register,
  login,
  refreshSession,
  logout,
  getMe,
  changePassword,
  getGoogleAuthUrl,
  handleGoogleCallback,
} from '../services/auth.service.js';
import config from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { ROLE_VALUES, INTERVIEW_TYPE_VALUES } from '../../../shared/constants.js';
import { isValidZone } from '../lib/time.js';

const router = Router();

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), 'Password must contain a letter and a number');

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(160),
  password: passwordSchema,
  role: z.enum(ROLE_VALUES),
  timezone: z.string().refine(isValidZone, 'Unknown IANA timezone').default('UTC'),
  phone: z.string().trim().max(24).optional(),
  // role-specific optionals
  headline: z.string().trim().max(140).optional(),
  title: z.string().trim().max(120).optional(),
  department: z.string().trim().max(120).optional(),
  currentCompany: z.string().trim().max(120).optional(),
  yearsExperience: z.coerce.number().min(0).max(60).optional(),
  seniority: z.enum(['JUNIOR', 'MID', 'SENIOR', 'STAFF', 'PRINCIPAL']).optional(),
  interviewTypes: z.array(z.enum(INTERVIEW_TYPE_VALUES)).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

router.post(
  '/register',
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const session = await register(req.body, { ip: req.ip });
    res.status(201).json(session);
  })
);

router.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const session = await login(req.body, { ip: req.ip });
    res.json(session);
  })
);

router.post(
  '/refresh',
  validateBody(z.object({ refreshToken: z.string().min(10) })),
  asyncHandler(async (req, res) => {
    res.json(await refreshSession(req.body.refreshToken));
  })
);

router.post(
  '/logout',
  validateBody(z.object({ refreshToken: z.string().optional() })),
  asyncHandler(async (req, res) => {
    await logout(req.body.refreshToken);
    res.json({ ok: true });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await getMe(req.user.id));
  })
);

router.get(
  '/status',
  asyncHandler(async (req, res) => {
    res.json({
      googleConfigured: config.google.configured,
      googleLoginRedirectUri: config.google.loginRedirectUri,
      frontendUrl: config.frontendUrl,
    });
  })
);

router.get(
  '/google/url',
  asyncHandler(async (req, res) => {
    const { role } = req.query;
    const url = getGoogleAuthUrl({ role });
    res.json({ url });
  })
);

router.get(
  '/google',
  asyncHandler(async (req, res) => {
    const { role } = req.query;
    if (!config.google.configured) {
      return res.redirect(
        `${config.frontendUrl}/login?error=${encodeURIComponent(
          'Google OAuth is not configured yet. Please add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env'
        )}`
      );
    }
    const url = getGoogleAuthUrl({ role });
    res.redirect(url);
  })
);

router.get(
  '/google/callback',
  asyncHandler(async (req, res) => {
    const { code, state, error, error_description } = req.query;

    if (error) {
      const msg = error_description || error;
      return res.redirect(`${config.frontendUrl}/login?error=${encodeURIComponent(msg)}`);
    }

    try {
      const session = await handleGoogleCallback({ code, state }, { ip: req.ip });
      const target = `${config.frontendUrl}/auth/callback?accessToken=${encodeURIComponent(
        session.accessToken
      )}&refreshToken=${encodeURIComponent(session.refreshToken)}`;
      res.redirect(target);
    } catch (err) {
      res.redirect(`${config.frontendUrl}/login?error=${encodeURIComponent(err.message)}`);
    }
  })
);

router.post(
  '/change-password',
  requireAuth,
  validateBody(z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema })),
  asyncHandler(async (req, res) => {
    await changePassword(req.user.id, req.body.currentPassword, req.body.newPassword);
    res.json({ ok: true, message: 'Password updated. Please sign in again.' });
  })
);

export default router;
