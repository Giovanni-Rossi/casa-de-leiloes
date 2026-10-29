import { logger } from '../logger.js';
import { settleDueLots } from '../services/settlement.js';

/** Liquida lotes vencidos a cada `intervalMs`. Nunca sobrepõe execuções. Devolve uma função que para o job. */
export function startSettlementJob(intervalMs, { settle = settleDueLots, log = logger } = {}) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await settle();
    } catch (err) {
      log.error({ err }, 'erro no agendador de liquidação');
    } finally {
      running = false;
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
