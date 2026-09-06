/**
 * Terminal error handler.
 *
 * Contract: the client always receives `{ error: { code, message, details? } }`.
 * Stack traces and raw driver messages never cross the boundary - they are
 * logged server-side with a correlation id the user can quote in a bug report.
 */
import crypto from 'node:crypto';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import logger from '../lib/logger.js';
import config from '../config/env.js';

/** Map Prisma's driver-level errors onto meaningful HTTP responses. */
function fromPrisma(err) {
  const code = err?.code;
  if (!code || typeof code !== 'string' || !code.startsWith('P')) return null;
  switch (code) {
    case 'P2002':
      return new AppError('That record already exists', {
        status: 409,
        code: 'DUPLICATE',
        details: { fields: err.meta?.target },
      });
    case 'P2003':
      return new AppError('Related record does not exist', { status: 400, code: 'FK_VIOLATION' });
    case 'P2025':
      return new AppError('Record not found', { status: 404, code: 'NOT_FOUND' });
    case 'P1001':
    case 'P1002':
      return new AppError('The database is unreachable. Please try again shortly.', {
        status: 503,
        code: 'DATABASE_UNAVAILABLE',
      });
    default:
      return new AppError('A database error occurred', { status: 500, code: 'DATABASE_ERROR' });
  }
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}` },
  });
}

// eslint-disable-next-line no-unused-vars -- Express identifies handlers by arity
export function errorHandler(err, req, res, _next) {
  const incidentId = crypto.randomBytes(6).toString('hex');

  if (err instanceof ZodError) {
    return res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Some fields need attention',
        details: err.issues.map((i) => ({ field: i.path.join('.') || '(body)', message: i.message })),
      },
    });
  }

  const mapped = err instanceof AppError ? err : fromPrisma(err);

  if (mapped) {
    if (mapped.status >= 500) {
      logger.error('Request failed', { incidentId, url: req.originalUrl, error: err.message, stack: err.stack });
    } else {
      logger.debug('Request rejected', { code: mapped.code, url: req.originalUrl, message: mapped.message });
    }
    return res.status(mapped.status).json({
      error: {
        code: mapped.code,
        message: mapped.message,
        ...(mapped.details ? { details: mapped.details } : {}),
        ...(mapped.status >= 500 ? { incidentId } : {}),
      },
    });
  }

  logger.error('Unhandled error', {
    incidentId,
    url: req.originalUrl,
    method: req.method,
    error: err?.message,
    stack: err?.stack,
  });

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side. The team has been notified.',
      incidentId,
      ...(config.isProd ? {} : { debug: err?.message }),
    },
  });
}

/** Wrap async route handlers so rejected promises reach the error handler. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
