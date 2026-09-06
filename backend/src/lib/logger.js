/** Tiny structured logger - no dependency, JSON in production, readable in dev. */
import config from '../config/env.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL || (config.isTest ? 'warn' : 'debug')] ?? 10;

const COLORS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };

function emit(level, message, meta) {
  if (LEVELS[level] < threshold) return;
  const time = new Date().toISOString();
  if (config.isProd) {
    console[level === 'debug' ? 'log' : level](JSON.stringify({ time, level, message, ...meta }));
    return;
  }
  const color = COLORS[level] || '';
  const suffix = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  console[level === 'debug' ? 'log' : level](
    `${color}${time.slice(11, 23)} ${level.toUpperCase().padEnd(5)}\x1b[0m ${message}${suffix}`
  );
}

export const logger = {
  debug: (m, meta) => emit('debug', m, meta),
  info: (m, meta) => emit('info', m, meta),
  warn: (m, meta) => emit('warn', m, meta),
  error: (m, meta) => emit('error', m, meta),
};

export default logger;
