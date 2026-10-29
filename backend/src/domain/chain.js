import { createHmac } from 'node:crypto';
import { config } from '../config.js';

export const GENESIS_HASH = '0'.repeat(64);

const hmac = (data) => createHmac('sha256', config.hashSecret).update(data).digest('hex');

/** Hash de um lance: amarra o conteúdo ao hash do lance anterior (cadeia). */
export function bidHash({ lotId, seq, bidderId, amountCents, createdMs, prevHash }) {
  return hmac(`bid|${lotId}|${seq}|${bidderId}|${amountCents}|${createdMs}|${prevHash}`);
}

/**
 * Pseudônimo do licitante dentro de UM lote. Varia por lote para que ninguém
 * consiga correlacionar o mesmo licitante entre lotes diferentes.
 */
export function pseudonym(lotId, bidderId) {
  return 'Licitante ' + hmac(`alias|${lotId}|${bidderId}`).slice(0, 6).toUpperCase();
}

/**
 * Verifica a cadeia de um lote contra a "âncora" guardada na linha do lote
 * (head_hash, bid_count, lance atual e líder). Cobre:
 *  - edição de qualquer campo de um lance (o hash não bate);
 *  - remoção no meio (seq com buraco / prev_hash quebrado);
 *  - remoção do último lance (contagem/âncora não batem);
 *  - inserção posterior (seq extra, ou hash inválido sem o segredo).
 */
export function verifyChain(lot, bids) {
  const problems = [];
  let prev = GENESIS_HASH;
  bids.forEach((b, i) => {
    const expectedSeq = i + 1;
    if (b.seq !== expectedSeq) {
      problems.push({
        seq: b.seq,
        reason: `Sequência inesperada (esperado #${expectedSeq}) — lance removido ou inserido`,
      });
    }
    if (b.prev_hash !== prev) {
      problems.push({ seq: b.seq, reason: 'Elo anterior da cadeia não confere' });
    }
    const expected = bidHash({
      lotId: lot.id,
      seq: b.seq,
      bidderId: b.bidder_id,
      amountCents: b.amount_cents,
      createdMs: b.created_ms,
      prevHash: b.prev_hash,
    });
    if (expected !== b.hash) {
      problems.push({ seq: b.seq, reason: 'Conteúdo do lance foi alterado (hash não confere)' });
    }
    prev = b.hash;
  });

  const last = bids[bids.length - 1];
  if (bids.length !== lot.bid_count) {
    problems.push({
      seq: null,
      reason: `Quantidade de lances (${bids.length}) difere da registrada no lote (${lot.bid_count})`,
    });
  }
  if ((last?.hash ?? null) !== (lot.head_hash ?? null)) {
    problems.push({ seq: null, reason: 'Hash final da cadeia difere do registrado no lote' });
  }
  if (last && (last.amount_cents !== lot.current_bid_cents || last.bidder_id !== lot.leader_id)) {
    problems.push({
      seq: null,
      reason: 'Lance vencedor/atual do lote não corresponde ao último lance do histórico',
    });
  }
  return problems;
}
