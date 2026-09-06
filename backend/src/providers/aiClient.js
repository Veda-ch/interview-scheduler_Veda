/**
 * HTTP client for the Python AI + optimization service.
 *
 * Resilience design: the scheduling loop must keep working when the AI service
 * is down, slow, or returning nonsense. So every call is
 *   - time-bounded (AbortController),
 *   - guarded by a circuit breaker (stop hammering a dead service),
 *   - and returns `{ ok, data, error, degraded }` instead of throwing, so the
 *     caller can consciously choose a deterministic fallback.
 */
import config from '../config/env.js';
import logger from '../lib/logger.js';

const FAILURE_THRESHOLD = 3;
const OPEN_MS = 30_000;

const breaker = { failures: 0, openedAt: 0, state: 'CLOSED' };

function breakerAllows() {
  if (breaker.state === 'OPEN') {
    if (Date.now() - breaker.openedAt > OPEN_MS) {
      breaker.state = 'HALF_OPEN';
      return true;
    }
    return false;
  }
  return true;
}

function onSuccess() {
  breaker.failures = 0;
  breaker.state = 'CLOSED';
}

function onFailure() {
  breaker.failures += 1;
  if (breaker.failures >= FAILURE_THRESHOLD) {
    breaker.state = 'OPEN';
    breaker.openedAt = Date.now();
    logger.warn('AI service circuit breaker OPEN - using deterministic fallbacks', {
      failures: breaker.failures,
      reopenInMs: OPEN_MS,
    });
  }
}

export const breakerState = () => ({
  state: breaker.state,
  failures: breaker.failures,
  retryInMs: breaker.state === 'OPEN' ? Math.max(0, OPEN_MS - (Date.now() - breaker.openedAt)) : 0,
});

/**
 * @returns {Promise<{ok: boolean, data?: any, error?: string, code?: string, degraded?: boolean, latencyMs: number}>}
 */
export async function callAiService(path, body, { timeoutMs, method = 'POST' } = {}) {
  const started = Date.now();

  if (!breakerAllows()) {
    return {
      ok: false,
      error: 'AI service circuit breaker is open',
      code: 'CIRCUIT_OPEN',
      degraded: true,
      latencyMs: 0,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? config.aiService.timeoutMs);

  try {
    const res = await fetch(`${config.aiService.url}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-service-token': config.aiService.token,
      },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - started;
    const text = await res.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      onFailure();
      return { ok: false, error: 'AI service returned non-JSON', code: 'BAD_RESPONSE', degraded: true, latencyMs };
    }

    if (!res.ok) {
      // 4xx is our bug, not the service being down - do not trip the breaker.
      if (res.status >= 500) onFailure();
      else onSuccess();
      return {
        ok: false,
        error: payload?.detail?.message || payload?.detail || `AI service responded ${res.status}`,
        code: res.status >= 500 ? 'AI_SERVICE_ERROR' : 'AI_BAD_REQUEST',
        degraded: res.status >= 500,
        latencyMs,
      };
    }

    onSuccess();
    return { ok: true, data: payload, latencyMs };
  } catch (err) {
    onFailure();
    const aborted = err.name === 'AbortError';
    logger.warn('AI service call failed', { path, error: aborted ? 'timeout' : err.message });
    return {
      ok: false,
      error: aborted ? 'AI service timed out' : `AI service unreachable: ${err.message}`,
      code: aborted ? 'AI_TIMEOUT' : 'AI_UNREACHABLE',
      degraded: true,
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function aiServiceHealth() {
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${config.aiService.url}/health`, { signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, latencyMs: Date.now() - started, ...data, breaker: breakerState() };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err.name === 'AbortError' ? 'timeout' : err.message,
      breaker: breakerState(),
    };
  }
}
