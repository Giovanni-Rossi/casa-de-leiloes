import { randomBytes } from 'node:crypto';
import { db, tx } from '../db.js';
import { logger } from '../logger.js';
import * as users from '../repositories/users.js';
import * as lots from '../repositories/lots.js';
import * as transactions from '../repositories/transactions.js';
import * as receipts from '../repositories/receipts.js';
import { broadcastLot } from './broadcast.js';

/** Liquida um lote encerrado: debita o vencedor, credita o leiloeiro e emite o comprovante. */
export async function settleLot(lotId) {
  const settled = await tx(async (c) => {
    const probe = await lots.findById(c, lotId);
    if (!probe || probe.status !== 'active') return null;
    // Mesma ordem de locks do placeBid: usuários (por id) e só depois o lote.
    const ids = [...new Set([probe.seller_id, probe.leader_id].filter(Boolean))].sort(
      (a, b) => a - b,
    );
    await users.lockByIds(c, ids);
    const lot = await lots.lockById(c, lotId);
    if (lot.status !== 'active' || new Date(lot.ends_at).getTime() > Date.now()) return null;

    if (lot.bid_count === 0) {
      await lots.markSettledWithoutWinner(c, lotId);
      return { sold: false };
    }
    const amountCents = lot.current_bid_cents;
    if (!(await users.debit(c, lot.leader_id, amountCents))) {
      throw new Error(`Invariante violada: saldo insuficiente na liquidação do lote ${lotId}`);
    }
    await users.credit(c, lot.seller_id, amountCents);
    await transactions.insertSale(c, {
      lotId,
      winnerId: lot.leader_id,
      sellerId: lot.seller_id,
      amountCents,
    });
    await receipts.insert(c, {
      lotId,
      token: randomBytes(16).toString('base64url'),
      winnerId: lot.leader_id,
      sellerId: lot.seller_id,
      amountCents,
      bidCount: lot.bid_count,
      headHash: lot.head_hash,
    });
    await lots.markSold(c, lotId, amountCents);
    return { sold: true };
  });
  if (settled) {
    logger.info({ lotId, sold: settled.sold }, 'lote liquidado');
    await broadcastLot(lotId, 'settled');
  }
  return settled;
}

/** Liquida todos os lotes vencidos; uma falha num lote não impede os demais. */
export async function settleDueLots(log = logger) {
  for (const id of await lots.listDueIds(db)) {
    try {
      await settleLot(id);
    } catch (err) {
      log.error({ err, lotId: id }, 'falha ao liquidar lote');
    }
  }
}
