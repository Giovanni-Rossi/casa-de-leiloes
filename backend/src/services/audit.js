import { db } from '../db.js';
import { pseudonym, verifyChain } from '../domain/chain.js';
import { phaseOf } from '../domain/lot.js';
import { notFound } from '../errors.js';
import * as bids from '../repositories/bids.js';
import * as receipts from '../repositories/receipts.js';
import { getLot, getVisibleLot } from './lots.js';

/** Verifica a cadeia do lote e devolve o histórico anonimizado. */
export async function auditOf(lot) {
  const rows = await bids.listByLot(db, lot.id);
  const problems = verifyChain(lot, rows);
  return {
    intact: problems.length === 0,
    problems,
    bids: rows.map((b) => ({
      seq: b.seq,
      bidder: pseudonym(lot.id, b.bidder_id),
      amountCents: b.amount_cents,
      at: new Date(Number(b.created_ms)).toISOString(),
      prevHash: b.prev_hash,
      hash: b.hash,
    })),
  };
}

export async function publicAudit(lotId) {
  const lot = await getLot(lotId);
  if (lot.status === 'cancelled') throw notFound('Lote não encontrado');
  return {
    lot: {
      id: lot.id,
      title: lot.title,
      imageUrl: lot.image_url,
      phase: phaseOf(lot),
      bidCount: lot.bid_count,
    },
    headHash: lot.head_hash,
    ...(await auditOf(lot)),
  };
}

/** Histórico exibido na sala do lote; "mine" só é informado ao próprio licitante. */
export async function roomBids(lotId, viewerId) {
  const lot = await getVisibleLot(lotId, viewerId);
  const { bids: history } = await auditOf(lot);
  const mine = new Set(viewerId ? await bids.seqsFrom(db, lot.id, viewerId) : []);
  return history
    .map(({ seq, bidder, amountCents, at }) => ({
      seq,
      bidder,
      amountCents,
      at,
      mine: mine.has(seq),
    }))
    .reverse();
}

export async function receiptByToken(token) {
  const r = await receipts.findByToken(db, token);
  if (!r) throw notFound('Comprovante não encontrado');
  const lot = await getLot(r.lot_id);
  const audit = await auditOf(lot);
  return {
    lotId: lot.id,
    title: lot.title,
    imageUrl: lot.image_url,
    attributes: lot.attributes,
    amountCents: r.amount_cents,
    winner: pseudonym(lot.id, r.winner_id),
    seller: pseudonym(lot.id, r.seller_id).replace('Licitante', 'Leiloeiro'),
    bidCount: r.bid_count,
    headHash: r.head_hash,
    issuedAt: r.issued_at,
    // Íntegro só se o histórico está íntegro E o lote ainda aponta para o hash emitido.
    auditIntact: audit.intact && lot.head_hash === r.head_hash,
  };
}
