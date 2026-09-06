/**
 * Authentication + role-based access control.
 *
 * Three layers, deliberately separate:
 *   requireAuth   - is this a valid session?
 *   requireRole   - is this role allowed on this route?
 *   ownership helpers - is this *specific* row theirs? (a candidate must not be
 *                       able to read another candidate's interview by guessing an id)
 */
import { verifyAccessToken } from '../services/auth.service.js';
import { unauthorized, forbidden } from '../lib/errors.js';
import prisma from '../lib/prisma.js';
import { recordAudit } from '../services/audit.service.js';
import { AUDIT_ACTIONS, ROLES } from '../../../shared/constants.js';

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  if (req.cookies?.accessToken) return req.cookies.accessToken;
  return null;
}

export function requireAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next(unauthorized('Missing authentication token'));
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role, email: payload.email, name: payload.name };
    return next();
  } catch (err) {
    return next(err);
  }
}

/** Attaches req.user when a token is present but never rejects. */
export function optionalAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role, email: payload.email, name: payload.name };
  } catch {
    /* ignore - treated as anonymous */
  }
  return next();
}

export function requireRole(...roles) {
  const allowed = new Set(roles.flat());
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!allowed.has(req.user.role)) {
      recordAudit({
        actorUserId: req.user.id,
        actorRole: req.user.role,
        action: AUDIT_ACTIONS.UNAUTHORIZED_ACCESS,
        entity: 'Route',
        entityId: req.originalUrl,
        summary: `${req.user.role} blocked from ${req.method} ${req.originalUrl}`,
        ip: req.ip,
      });
      return next(forbidden(`This action requires one of: ${[...allowed].join(', ')}`));
    }
    return next();
  };
}

export const requireRecruiter = requireRole(ROLES.RECRUITER, ROLES.ADMIN);
export const requireAdmin = requireRole(ROLES.ADMIN);
export const requireCandidate = requireRole(ROLES.CANDIDATE, ROLES.ADMIN);
export const requireInterviewer = requireRole(ROLES.INTERVIEWER, ROLES.ADMIN);

const isPrivileged = (user) => user.role === ROLES.RECRUITER || user.role === ROLES.ADMIN;

/** Resolve the caller's own profile id for their role (cached on req). */
export async function loadOwnProfile(req) {
  if (req.ownProfile !== undefined) return req.ownProfile;
  const { id, role } = req.user;
  let profile = null;
  if (role === ROLES.CANDIDATE) profile = await prisma.candidateProfile.findUnique({ where: { userId: id } });
  else if (role === ROLES.INTERVIEWER) profile = await prisma.interviewerProfile.findUnique({ where: { userId: id } });
  else if (role === ROLES.RECRUITER) profile = await prisma.recruiterProfile.findUnique({ where: { userId: id } });
  req.ownProfile = profile;
  return profile;
}

/**
 * Guard for /candidates/:id style routes: a candidate may only touch their own
 * profile; recruiters and admins may read any.
 */
export function requireCandidateAccess({ writable = false } = {}) {
  return async (req, _res, next) => {
    try {
      const targetId = req.params.id || req.params.candidateId;
      if (isPrivileged(req.user)) {
        if (writable && req.user.role === ROLES.RECRUITER) {
          // recruiters may not silently edit candidate-owned preference data
          const own = await loadOwnProfile(req);
          if (!own) return next(forbidden('Recruiter profile missing'));
        }
        return next();
      }
      const own = await loadOwnProfile(req);
      if (!own || own.id !== targetId) {
        await recordAudit({
          actorUserId: req.user.id,
          actorRole: req.user.role,
          action: AUDIT_ACTIONS.UNAUTHORIZED_ACCESS,
          entity: 'CandidateProfile',
          entityId: targetId,
          summary: 'Attempted access to another candidate profile',
          ip: req.ip,
        });
        return next(forbidden('You can only access your own candidate profile'));
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export function requireInterviewerAccess() {
  return async (req, _res, next) => {
    try {
      const targetId = req.params.id || req.params.interviewerId;
      if (isPrivileged(req.user)) return next();
      const own = await loadOwnProfile(req);
      if (!own || own.id !== targetId) {
        return next(forbidden('You can only access your own interviewer profile'));
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Central authorisation check for a single interview. Returns the interview with
 * the relations every caller needs, or throws 403/404. Used by every
 * /api/interviews/:id/* route so the rule lives in exactly one place.
 */
export async function authorizeInterview(req, interviewId, { action = 'view' } = {}) {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: {
      panel: { include: { interviewer: { include: { user: true } } } },
      request: {
        include: {
          application: {
            include: {
              candidate: { include: { user: true } },
              job: { include: { recruiter: { include: { user: true } } } },
            },
          },
        },
      },
      meeting: true,
      calendarEvent: true,
    },
  });
  if (!interview) throw new (await import('../lib/errors.js')).AppError('Interview not found', { status: 404, code: 'NOT_FOUND' });

  const { role, id: userId } = req.user;
  if (role === ROLES.ADMIN) return interview;

  if (role === ROLES.RECRUITER) {
    // Recruiters see interviews for jobs they own.
    const ownerUserId = interview.request.application.job.recruiter.userId;
    if (ownerUserId !== userId) {
      // Other recruiters in the org can still view; only the owner may mutate.
      if (action !== 'view') throw forbidden('Only the recruiter who owns this job can change this interview');
    }
    return interview;
  }

  if (role === ROLES.CANDIDATE) {
    if (interview.request.application.candidate.userId !== userId) {
      await recordAudit({
        actorUserId: userId,
        actorRole: role,
        action: AUDIT_ACTIONS.UNAUTHORIZED_ACCESS,
        entity: 'Interview',
        entityId: interviewId,
        summary: 'Candidate attempted to access an interview that is not theirs',
        ip: req.ip,
      });
      throw forbidden('This interview does not belong to you');
    }
    return interview;
  }

  if (role === ROLES.INTERVIEWER) {
    const onPanel = interview.panel.some((p) => p.interviewer.userId === userId);
    if (!onPanel) {
      await recordAudit({
        actorUserId: userId,
        actorRole: role,
        action: AUDIT_ACTIONS.UNAUTHORIZED_ACCESS,
        entity: 'Interview',
        entityId: interviewId,
        summary: 'Interviewer attempted to access an interview they are not on',
        ip: req.ip,
      });
      throw forbidden('You are not on this interview panel');
    }
    return interview;
  }

  throw forbidden();
}
