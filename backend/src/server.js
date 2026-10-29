import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { logger } from './logger.js';
import { migrate } from './db.js';
import { seed } from './seed.js';
import { createApp } from './http/app.js';
import { startSettlementJob } from './jobs/settlementJob.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

/** Migra, semeia, sobe o HTTP e o job de liquidação. Devolve { server, stop }. */
export async function start({
  port = config.port,
  autoSeed = process.env.AUTO_SEED !== 'false',
} = {}) {
  await migrate();
  if (autoSeed) await seed();
  const server = createApp({ publicDir }).listen(port);
  await new Promise((resolve) => server.once('listening', resolve));
  const stopJob = startSettlementJob(config.schedulerIntervalMs);
  logger.info({ port: server.address().port }, 'servidor iniciado');
  return {
    server,
    stop: () => {
      stopJob();
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
