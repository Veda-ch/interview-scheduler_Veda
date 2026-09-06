/**
 * Runtime-tunable policy. Values live in the SystemSetting table so an admin can
 * change the default buffer or the autonomy ceiling without a redeploy; .env
 * supplies the boot defaults. Cached for 30s to keep the scheduler hot path fast.
 */
import prisma from '../lib/prisma.js';
import config from '../config/env.js';
import logger from '../lib/logger.js';
import { SETTING_KEYS } from '../../../shared/constants.js';
import { parseJson, stringifyJson } from '../lib/json.js';

const CACHE_TTL_MS = 30_000;
let cache = { at: 0, values: null };

export const DEFAULT_SETTINGS = {
  [SETTING_KEYS.DEFAULT_BUFFER_MINUTES]: { value: config.scheduling.defaultBufferMinutes, valueType: 'INT', description: 'Minutes of protected gap before and after every interview.' },
  [SETTING_KEYS.SLOT_GRANULARITY_MINUTES]: { value: config.scheduling.slotGranularityMinutes, valueType: 'INT', description: 'Candidate slot start alignment, in minutes.' },
  [SETTING_KEYS.DEFAULT_WORK_START_MINUTE]: { value: 540, valueType: 'INT', description: 'Default working-day start (minutes after local midnight).' },
  [SETTING_KEYS.DEFAULT_WORK_END_MINUTE]: { value: 1080, valueType: 'INT', description: 'Default working-day end (minutes after local midnight).' },
  [SETTING_KEYS.AUTONOMY_AUTO_APPLY_MAX_RISK]: { value: config.scheduling.autonomyMaxRisk, valueType: 'STRING', description: 'Highest recovery risk level the Control Tower may apply without human approval (LOW|MEDIUM|HIGH).' },
  [SETTING_KEYS.MAX_PROPOSALS]: { value: 5, valueType: 'INT', description: 'How many ranked slot proposals to return per request.' },
  [SETTING_KEYS.PROPOSAL_TTL_HOURS]: { value: 48, valueType: 'INT', description: 'Hours before an unaccepted slot proposal expires.' },
  [SETTING_KEYS.MONITOR_ENABLED]: { value: true, valueType: 'BOOL', description: 'Whether the Control Tower background monitor runs.' },
  [SETTING_KEYS.OVERRUN_GRACE_MINUTES]: { value: 10, valueType: 'INT', description: 'Minutes past scheduled end before an overrun incident is raised.' },
};

function coerce(raw, valueType) {
  switch (valueType) {
    case 'INT': return Number.parseInt(raw, 10);
    case 'FLOAT': return Number.parseFloat(raw);
    case 'BOOL': return /^(1|true|yes|on)$/i.test(String(raw));
    case 'JSON': return parseJson(raw, null);
    default: return raw;
  }
}

const serialise = (value) => (typeof value === 'object' ? stringifyJson(value) : String(value));

/** Ensures every known key exists in the DB; called once at boot and by the seed. */
export async function ensureDefaultSettings() {
  for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.systemSetting.upsert({
      where: { key },
      update: {}, // never clobber an admin's change
      create: { key, value: serialise(def.value), valueType: def.valueType, description: def.description },
    });
  }
  cache = { at: 0, values: null };
}

export async function getSettings({ force = false } = {}) {
  if (!force && cache.values && Date.now() - cache.at < CACHE_TTL_MS) return cache.values;

  const values = {};
  for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) values[key] = def.value;

  try {
    const rows = await prisma.systemSetting.findMany();
    for (const row of rows) {
      const def = DEFAULT_SETTINGS[row.key];
      values[row.key] = coerce(row.value, row.valueType || def?.valueType || 'STRING');
    }
  } catch (err) {
    // A settings read must never break scheduling: fall back to .env defaults.
    logger.warn('Falling back to environment defaults for settings', { error: err.message });
  }

  cache = { at: Date.now(), values };
  return values;
}

export async function getSetting(key) {
  const all = await getSettings();
  return all[key];
}

export async function listSettings() {
  const rows = await prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
  return rows.map((r) => ({
    key: r.key,
    value: coerce(r.value, r.valueType),
    rawValue: r.value,
    valueType: r.valueType,
    description: r.description,
    updatedAt: r.updatedAt,
  }));
}

export async function updateSetting(key, value) {
  const def = DEFAULT_SETTINGS[key];
  if (!def) throw new Error(`Unknown setting: ${key}`);
  const row = await prisma.systemSetting.update({
    where: { key },
    data: { value: serialise(value), valueType: def.valueType },
  });
  cache = { at: 0, values: null };
  return { key: row.key, value: coerce(row.value, row.valueType) };
}

export const invalidateSettingsCache = () => {
  cache = { at: 0, values: null };
};
