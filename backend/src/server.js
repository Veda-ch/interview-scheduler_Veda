/** Process entry point: boot checks, HTTP listener, background monitor, graceful shutdown. */
import fs from 'node:fs';
import config from './config/env.js';
import logger from './lib/logger.js';
import { createApp } from './app.js';
import { checkDatabase, disconnectPrisma } from './lib/prisma.js';
import { ensureDefaultSettings } from './services/settings.service.js';
import { startMonitor, stopMonitor } from './jobs/monitor.js';

async function bootstrap() {
  fs.mkdirSync(config.upload.dir, { recursive: true });

  const db = await checkDatabase();
  if (!db.ok) {
    logger.error('Cannot reach the database. Run `npm run db:push` at the repo root first.', {
      error: db.error,
    });
    process.exit(1);
  }
  await ensureDefaultSettings();

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(`API listening on http://localhost:${config.port}`, {
      env: config.env,
      demoMode: config.demoMode,
      providers: config.providers,
    });
  });

  if (config.monitor.enabled) startMonitor();

  const shutdown = async (signal) => {
    logger.info(`${signal} received, shutting down`);
    stopMonitor();
    server.close(async () => {
      await disconnectPrisma();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) =>
    logger.error('Unhandled promise rejection', { reason: String(reason) })
  );
}

bootstrap().catch((err) => {
  logger.error('Fatal boot error', { error: err.message, stack: err.stack });
  process.exit(1);
});
