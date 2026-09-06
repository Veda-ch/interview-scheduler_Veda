/**
 * Idempotency for unsafe POSTs (scheduling, confirming, cancelling).
 *
 * The client sends `Idempotency-Key: <uuid>`; a replay of the same key on the
 * same endpoint by the same user returns the stored response instead of
 * creating a second interview. This is the defence against double-clicks and
 * network retries - the DB-level booking guard handles genuinely concurrent
 * requests from *different* keys.
 */
import prisma from '../lib/prisma.js';
import logger from '../lib/logger.js';

export function idempotency() {
  return async (req, res, next) => {
    const key = req.headers['idempotency-key'];
    if (!key || typeof key !== 'string' || key.length < 8 || key.length > 200) return next();

    const scopedKey = `${req.user?.id || 'anon'}:${req.method}:${req.baseUrl}${req.path}:${key}`;

    try {
      const existing = await prisma.idempotencyKey.findUnique({ where: { key: scopedKey } });
      if (existing) {
        res.setHeader('Idempotent-Replay', 'true');
        return res.status(existing.statusCode).json(JSON.parse(existing.responseJson));
      }
    } catch (err) {
      logger.warn('Idempotency lookup failed, continuing', { error: err.message });
      return next();
    }

    // Capture the response so a later replay can be served from storage.
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        prisma.idempotencyKey
          .create({
            data: {
              key: scopedKey,
              userId: req.user?.id ?? null,
              endpoint: `${req.method} ${req.baseUrl}${req.path}`,
              statusCode: res.statusCode,
              responseJson: JSON.stringify(body ?? {}),
            },
          })
          .catch(() => {
            /* a lost idempotency record is not worth failing the request over */
          });
      }
      return originalJson(body);
    };

    return next();
  };
}

export default idempotency;
