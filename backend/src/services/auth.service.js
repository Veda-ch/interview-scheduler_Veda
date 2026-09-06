/**
 * Authentication: bcrypt password hashing + short-lived JWT access tokens with
 * rotating, hashed-at-rest refresh tokens.
 *
 * Why refresh-token rotation: a 30-minute access token limits the blast radius
 * of a leaked token, and storing only the SHA-256 of the refresh token means a
 * database dump cannot be replayed as a session.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import config from '../config/env.js';
import { unauthorized, conflict, badRequest } from '../lib/errors.js';
import { recordAudit } from './audit.service.js';
import { AUDIT_ACTIONS, ROLES } from '../../../shared/constants.js';
import { safeZone } from '../lib/time.js';

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export const hashPassword = (plain) => bcrypt.hash(plain, config.bcryptRounds);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email, name: user.name },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessTtl, issuer: 'interview-scheduler' }
  );
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.jwt.accessSecret, { issuer: 'interview-scheduler' });
  } catch (err) {
    throw unauthorized(err.name === 'TokenExpiredError' ? 'Session expired, please sign in again' : 'Invalid token');
  }
}

async function issueRefreshToken(userId) {
  const raw = crypto.randomBytes(48).toString('hex');
  const ttlDays = Number.parseInt(config.jwt.refreshTtl, 10) || 7;
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
    },
  });
  return raw;
}

/** Profile row is created in the same transaction as the user, per role. */
async function createProfileForRole(tx, user, extra = {}) {
  switch (user.role) {
    case ROLES.CANDIDATE:
      return tx.candidateProfile.create({
        data: {
          userId: user.id,
          headline: extra.headline || null,
          yearsExperience: Number(extra.yearsExperience) || 0,
          currentCompany: extra.currentCompany || null,
        },
      });
    case ROLES.INTERVIEWER:
      return tx.interviewerProfile.create({
        data: {
          userId: user.id,
          title: extra.title || null,
          department: extra.department || null,
          yearsExperience: Number(extra.yearsExperience) || 0,
          seniority: extra.seniority || 'MID',
          interviewTypesCsv: extra.interviewTypes?.length ? extra.interviewTypes.join(',') : 'TECHNICAL',
        },
      });
    case ROLES.RECRUITER:
      return tx.recruiterProfile.create({
        data: { userId: user.id, department: extra.department || null, title: extra.title || null },
      });
    default:
      return null; // ADMIN has no extra profile
  }
}

export async function register({ name, email, password, role, timezone, phone, ...extra }, meta = {}) {
  const normalisedEmail = String(email).trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email: normalisedEmail } });
  if (existing) throw conflict('An account with that email already exists', 'EMAIL_TAKEN');

  const passwordHash = await hashPassword(password);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: name.trim(),
        email: normalisedEmail,
        passwordHash,
        role,
        timezone: safeZone(timezone),
        phone: phone || null,
        avatarSeed: crypto.randomBytes(4).toString('hex'),
      },
    });
    await createProfileForRole(tx, created, extra);
    return created;
  });

  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: AUDIT_ACTIONS.USER_REGISTERED,
    entity: 'User',
    entityId: user.id,
    summary: `${user.name} registered as ${user.role}`,
    ip: meta.ip,
  });

  return issueSession(user);
}

export async function login({ email, password }, meta = {}) {
  const normalisedEmail = String(email).trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalisedEmail } });

  // Constant-ish response: same error for unknown user and wrong password.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    await recordAudit({
      actorRole: 'ANONYMOUS',
      action: AUDIT_ACTIONS.USER_LOGIN_FAILED,
      entity: 'User',
      entityId: user?.id ?? null,
      summary: `Failed sign-in attempt for ${normalisedEmail}`,
      ip: meta.ip,
    });
    throw unauthorized('Invalid email or password');
  }
  if (!user.isActive) throw unauthorized('This account has been deactivated');

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: AUDIT_ACTIONS.USER_LOGIN,
    entity: 'User',
    entityId: user.id,
    summary: `${user.name} signed in`,
    ip: meta.ip,
  });

  return issueSession(user);
}

async function issueSession(user) {
  const accessToken = signAccessToken(user);
  const refreshToken = await issueRefreshToken(user.id);
  return { accessToken, refreshToken, user: publicUser(user) };
}

export async function refreshSession(rawToken) {
  if (!rawToken) throw unauthorized('Missing refresh token');
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: true },
  });
  if (!record || record.revokedAt || record.expiresAt < new Date()) {
    throw unauthorized('Refresh token is invalid or expired');
  }
  // Rotation: the presented token is burned as soon as it is used.
  await prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
  if (!record.user.isActive) throw unauthorized('This account has been deactivated');
  return issueSession(record.user);
}

export async function logout(rawToken) {
  if (!rawToken) return;
  await prisma.refreshToken
    .updateMany({ where: { tokenHash: hashToken(rawToken) }, data: { revokedAt: new Date() } })
    .catch(() => {});
}

export async function changePassword(userId, currentPassword, newPassword) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthorized();
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw badRequest('Current password is incorrect');
  }
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  // Force re-auth everywhere.
  await prisma.refreshToken.updateMany({ where: { userId }, data: { revokedAt: new Date() } });
}

export const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  timezone: user.timezone,
  phone: user.phone ?? null,
  avatarSeed: user.avatarSeed ?? null,
  avatarUrl: user.avatarUrl ?? null,
  googleId: user.googleId ?? null,
  isActive: user.isActive,
  createdAt: user.createdAt,
});

/** Generate Google OAuth authorization URL with encoded state (role + nonce) */
export function getGoogleAuthUrl({ role = ROLES.CANDIDATE } = {}) {
  if (!config.google.configured) {
    throw badRequest(
      'Google OAuth is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file.'
    );
  }

  const validRole = [ROLES.RECRUITER, ROLES.CANDIDATE, ROLES.INTERVIEWER].includes(role)
    ? role
    : ROLES.CANDIDATE;

  const statePayload = Buffer.from(
    JSON.stringify({
      role: validRole,
      nonce: crypto.randomBytes(16).toString('hex'),
      time: Date.now(),
    })
  ).toString('base64url');

  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.loginRedirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
    state: statePayload,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Exchange Google OAuth code for tokens, fetch profile, and login or register user */
export async function handleGoogleCallback({ code, state }, meta = {}) {
  if (!config.google.configured) {
    throw badRequest('Google OAuth is not configured on the server.');
  }
  if (!code) {
    throw badRequest('Missing authorization code from Google.');
  }

  // Parse state to recover intended role
  let role = ROLES.CANDIDATE;
  if (state) {
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
      if ([ROLES.RECRUITER, ROLES.CANDIDATE, ROLES.INTERVIEWER].includes(decoded.role)) {
        role = decoded.role;
      }
    } catch {
      // Invalid state json, fall back to default
    }
  }

  // 1. Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: config.google.loginRedirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const errorBody = await tokenRes.text();
    throw badRequest(`Google token exchange failed: ${tokenRes.status} ${errorBody}`);
  }

  const tokenData = await tokenRes.json();
  const googleAccessToken = tokenData.access_token;

  // 2. Fetch user profile from OpenID Connect userinfo endpoint
  const userinfoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${googleAccessToken}` },
  });

  if (!userinfoRes.ok) {
    throw badRequest('Failed to fetch user profile from Google.');
  }

  const googleProfile = await userinfoRes.json();
  const { sub: googleId, email, name, picture } = googleProfile;

  if (!email) {
    throw badRequest('Google account did not return a verified email address.');
  }

  const normalisedEmail = String(email).trim().toLowerCase();

  // 3. Find existing user by googleId or email
  let user = await prisma.user.findFirst({
    where: {
      OR: [{ googleId }, { email: normalisedEmail }],
    },
  });

  if (user) {
    // Existing user: link googleId and avatarUrl if not set
    const updateData = { lastLoginAt: new Date() };
    if (!user.googleId) updateData.googleId = googleId;
    if (!user.avatarUrl && picture) updateData.avatarUrl = picture;

    user = await prisma.user.update({
      where: { id: user.id },
      data: updateData,
    });

    if (!user.isActive) throw unauthorized('This account has been deactivated');

    await recordAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: AUDIT_ACTIONS.USER_LOGIN,
      entity: 'User',
      entityId: user.id,
      summary: `${user.name} signed in with Google (${user.role})`,
      ip: meta.ip,
    });
  } else {
    // New user registration via Google
    const dummyPasswordHash = await hashPassword(crypto.randomBytes(32).toString('hex'));

    user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: (name || 'Google User').trim(),
          email: normalisedEmail,
          passwordHash: dummyPasswordHash,
          role,
          timezone: 'UTC',
          googleId,
          avatarUrl: picture || null,
          avatarSeed: crypto.randomBytes(4).toString('hex'),
        },
      });
      await createProfileForRole(tx, created, {});
      return created;
    });

    await recordAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: AUDIT_ACTIONS.USER_REGISTERED,
      entity: 'User',
      entityId: user.id,
      summary: `${user.name} registered with Google as ${user.role}`,
      ip: meta.ip,
    });
  }

  return issueSession(user);
}

/** Full "me" payload including the role-specific profile id the UI needs. */
export async function getMe(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      candidateProfile: { select: { id: true, headline: true, resumeUrl: true, yearsExperience: true } },
      interviewerProfile: { select: { id: true, title: true, seniority: true, interviewTypesCsv: true } },
      recruiterProfile: { select: { id: true, department: true, title: true } },
    },
  });
  if (!user) throw unauthorized();
  return {
    ...publicUser(user),
    profile:
      user.candidateProfile || user.interviewerProfile || user.recruiterProfile || null,
    profileId:
      user.candidateProfile?.id || user.interviewerProfile?.id || user.recruiterProfile?.id || null,
  };
}
