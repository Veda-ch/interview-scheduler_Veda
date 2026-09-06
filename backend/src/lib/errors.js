/**
 * Typed application errors. Every error surfaced to a client has a stable
 * machine-readable `code` so the UI can render a helpful message, and stack
 * traces never leave the server (see middleware/errorHandler.js).
 */
export class AppError extends Error {
  constructor(message, { status = 400, code = 'BAD_REQUEST', details = undefined } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true; // safe to show to the user
  }
}

export const badRequest = (m, details) => new AppError(m, { status: 400, code: 'BAD_REQUEST', details });
export const validationError = (m, details) =>
  new AppError(m, { status: 422, code: 'VALIDATION_ERROR', details });
export const unauthorized = (m = 'Authentication required') =>
  new AppError(m, { status: 401, code: 'UNAUTHENTICATED' });
export const forbidden = (m = 'You do not have access to this resource') =>
  new AppError(m, { status: 403, code: 'FORBIDDEN' });
export const notFound = (m = 'Resource not found') =>
  new AppError(m, { status: 404, code: 'NOT_FOUND' });
export const conflict = (m, code = 'CONFLICT', details) =>
  new AppError(m, { status: 409, code, details });
export const slotTaken = (details) =>
  new AppError('That time slot was just taken by another booking. Please pick another slot.', {
    status: 409,
    code: 'SLOT_TAKEN',
    details,
  });
export const unprocessable = (m, code = 'UNPROCESSABLE', details) =>
  new AppError(m, { status: 422, code, details });
export const noFeasibleSchedule = (details) =>
  new AppError(
    'No interview slot satisfies all hard constraints for this request.',
    { status: 422, code: 'NO_FEASIBLE_SLOT', details }
  );
export const dependencyFailure = (m, code = 'DEPENDENCY_FAILURE', details) =>
  new AppError(m, { status: 502, code, details });
export const tooManyRequests = (m = 'Too many requests, slow down') =>
  new AppError(m, { status: 429, code: 'RATE_LIMITED' });

export default AppError;
