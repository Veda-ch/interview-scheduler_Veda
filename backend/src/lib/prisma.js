/** Single Prisma client for the process (avoids connection storms on --watch reloads). */
import { PrismaClient } from '@prisma/client';
import config from '../config/env.js';
import logger from './logger.js';

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log: config.isProd ? ['warn', 'error'] : ['warn', 'error'],
  });

if (!config.isProd) globalForPrisma.__prisma = prisma;

/** Health probe used by /api/health - never throws. */
export async function checkDatabase() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    logger.error('Database health check failed', { error: err.message });
    return { ok: false, latencyMs: Date.now() - started, error: err.message };
  }
}

export async function disconnectPrisma() {
  try {
    await prisma.$disconnect();
  } catch {
    /* shutting down anyway */
  }
}

export default prisma;
