import { db } from '../db.js';
import { emitGlobal, emitLot } from '../events.js';
import * as lots from '../repositories/lots.js';
import { lotView } from './lotViews.js';

/** Publica o estado público do lote nos canais SSE (sala do lote e vitrine). */
export async function broadcastLot(lotId, event = 'lot') {
  const payload = { lot: await lotView(await lots.findById(db, lotId)) };
  emitLot(lotId, event, payload);
  emitGlobal('lot', payload);
}
