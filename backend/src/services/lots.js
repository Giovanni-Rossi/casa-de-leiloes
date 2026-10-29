import { db, tx } from '../db.js';
import { filterLots, parseLotInput, phaseOf } from '../domain/lot.js';
import { forbidden, notFound, rejection } from '../errors.js';
import { logger } from '../logger.js';
import * as lots from '../repositories/lots.js';
import * as receipts from '../repositories/receipts.js';
import { broadcastLot } from './broadcast.js';
import { lotView } from './lotViews.js';

export async function getLot(id) {
  const lot = await lots.findById(db, id);
  if (!lot) throw notFound('Lote não encontrado');
  return lot;
}

/** Lote visível ao público (cancelados só para o próprio leiloeiro). */
export async function getVisibleLot(id, viewerId) {
  const lot = await getLot(id);
  if (lot.status === 'cancelled' && lot.seller_id !== viewerId)
    throw notFound('Lote não encontrado');
  return lot;
}

export async function listShowcase(filters, viewerId) {
  const all = await lots.listNotCancelled(db);
  return Promise.all(filterLots(all, filters).map((l) => lotView(l, viewerId)));
}

export async function listSellerLots(sellerId) {
  const own = await lots.listBySeller(db, sellerId);
  return {
    totalReceivedCents: await lots.totalReceivedBy(db, sellerId),
    lots: await Promise.all(own.map((l) => lotView(l, sellerId))),
  };
}

export async function listMyBids(userId) {
  const rows = await lots.listWithBidFrom(db, userId);
  const tokens = new Map((await receipts.listByWinner(db, userId)).map((r) => [r.lot_id, r.token]));
  return Promise.all(
    rows.map(async (l) => ({
      ...(await lotView(l, userId)),
      won: l.winner_id === userId,
      receiptToken: tokens.get(l.id) ?? null,
    })),
  );
}

export async function createLot(sellerId, input) {
  const lot = await lots.insert(db, { sellerId, ...parseLotInput(input) });
  logger.info({ lotId: lot.id, sellerId }, 'lote criado');
  await broadcastLot(lot.id, 'created');
  return lot;
}

/**
 * Cancela um lote. Sem lances: simples. Com lances (opcional do desafio): o lote sai da
 * vitrine e o valor comprometido do líder é liberado automaticamente — o "comprometido"
 * é derivado dos lotes ativos, então o estorno é consistente por construção.
 */
export async function cancelLot({ lotId, sellerId }) {
  await tx(async (c) => {
    const lot = await lots.lockById(c, lotId);
    if (!lot) throw notFound('Lote não encontrado');
    if (lot.seller_id !== sellerId) throw forbidden('Você não é o dono deste lote');
    if (lot.status !== 'active' || phaseOf(lot) === 'ended') {
      throw rejection('cannot_cancel', 'Este lote já foi encerrado e não pode ser cancelado');
    }
    await lots.markCancelled(c, lotId);
  });
  logger.info({ lotId, sellerId }, 'lote cancelado');
  await broadcastLot(lotId, 'cancelled');
}
