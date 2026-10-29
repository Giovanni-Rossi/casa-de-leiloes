import { tx } from '../db.js';
import { config } from '../config.js';
import { bidHash, GENESIS_HASH } from '../domain/chain.js';
import { extendedEnd, minNextBid, phaseOf } from '../domain/lot.js';
import { parseAmountCents } from '../domain/user.js';
import { forbidden, notFound, rejection } from '../errors.js';
import { logger } from '../logger.js';
import * as users from '../repositories/users.js';
import * as lots from '../repositories/lots.js';
import * as bids from '../repositories/bids.js';
import { walletOf } from './wallet.js';
import { broadcastLot } from './broadcast.js';

const PHASE_REJECTIONS = {
  cancelled: ['lot_cancelled', 'Este lote foi cancelado'],
  ended: ['lot_ended', 'Lote encerrado'],
  scheduled: ['lot_not_started', 'Este lote ainda não foi iniciado'],
};

export async function placeBid({ lotId, userId, amountCents }) {
  parseAmountCents(amountCents, { message: 'Informe um valor de lance válido' });
  const result = await tx(async (c) => {
    // Ordem de locks (usuário -> lote) idêntica à da liquidação: evita deadlock e
    // serializa lances concorrentes do mesmo licitante (sem estourar o saldo).
    await users.lockById(c, userId);
    const lot = await lots.lockById(c, lotId);
    if (!lot) throw notFound('Lote não encontrado');
    if (lot.seller_id === userId) throw forbidden('O leiloeiro não pode dar lances');

    const now = Date.now();
    const phase = phaseOf(lot, now);
    if (phase !== 'live') throw rejection(...PHASE_REJECTIONS[phase]);
    if (lot.leader_id === userId)
      throw rejection('already_leading', 'Você já está ganhando este lote');
    if (amountCents < minNextBid(lot))
      throw rejection(
        'below_minimum',
        `Lance abaixo do mínimo (mínimo aceito: ${minNextBid(lot)} centavos)`,
      );
    if (amountCents > (await walletOf(userId, c)).availableCents) {
      throw rejection('insufficient_funds', 'Saldo disponível insuficiente para este lance');
    }

    const seq = lot.bid_count + 1;
    const prevHash = lot.head_hash ?? GENESIS_HASH;
    const hash = bidHash({ lotId, seq, bidderId: userId, amountCents, createdMs: now, prevHash });
    await bids.insert(c, {
      lotId,
      seq,
      bidderId: userId,
      amountCents,
      createdMs: now,
      prevHash,
      hash,
    });
    const newEnd = extendedEnd(new Date(lot.ends_at).getTime(), now, config.antiSnipingMs);
    await lots.recordBid(c, {
      lotId,
      amountCents,
      leaderId: userId,
      seq,
      hash,
      endsAt: new Date(newEnd ?? lot.ends_at),
    });
    return { seq, extended: newEnd !== null };
  });
  logger.info({ lotId, userId, amountCents, ...result }, 'lance aceito');
  await broadcastLot(lotId, 'bid');
  return result;
}
