/**
 * Safe (de)serialisation for the JSON-encoded String columns used by the
 * portable Prisma schema. Never throws - a corrupted column degrades to the
 * supplied fallback rather than taking down a request.
 */
import logger from './logger.js';

export function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    logger.warn('Corrupt JSON column, using fallback', { snippet: String(value).slice(0, 80) });
    return fallback;
  }
}

export const parseArray = (value) => {
  const parsed = parseJson(value, []);
  return Array.isArray(parsed) ? parsed : [];
};

export const parseObject = (value) => {
  const parsed = parseJson(value, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
};

export const stringifyJson = (value) => {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return 'null';
  }
};

export const csvToArray = (csv) =>
  String(csv || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const arrayToCsv = (arr) => (Array.isArray(arr) ? arr.filter(Boolean).join(',') : '');
