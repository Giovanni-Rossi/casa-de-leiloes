import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, makeUser, liveLot, pool, query } from '../helpers.js';
import { createLot, cancelLot } from '../../src/services/lots.js';
import { placeBid } from '../../src/services/bidding.js';
import { settleLot } from '../../src/services/settlement.js';
import { walletOf } from '../../src/services/wallet.js';
import { verifyChain } from '../../src/domain/chain.js';

before(resetDb);
beforeEach(resetDb);
after(() => pool.end());

const rejects = (promise, code) =>
  assert.rejects(promise, (e) => e.code === code, `esperava rejeição ${code}`);

test('regras de lance: mínimo, líder, saldo e fases', async () => {
  const seller = await makeUser('leiloeiro');
  const ana = await makeUser('licitante', 1000_00, 'ana');
  const bia = await makeUser('licitante', 120_00, 'bia');
  const lot = await liveLot(createLot, seller.id);

  await rejects(placeBid({ lotId: lot.id, userId: ana.id, amountCents: 99_00 }), 'below_minimum');
  await placeBid({ lotId: lot.id, userId: ana.id, amountCents: 100_00 });
  await rejects(
    placeBid({ lotId: lot.id, userId: ana.id, amountCents: 500_00 }),
    'already_leading',
  );
  await rejects(placeBid({ lotId: lot.id, userId: bia.id, amountCents: 105_00 }), 'below_minimum'); // atual + incremento = 110
  await rejects(
    placeBid({ lotId: lot.id, userId: bia.id, amountCents: 130_00 }),
    'insufficient_funds',
  );
  await placeBid({ lotId: lot.id, userId: bia.id, amountCents: 110_00 });
  await assert.rejects(
    placeBid({ lotId: lot.id, userId: seller.id, amountCents: 500_00 }),
    (e) => e.status === 403,
  );

  const future = await liveLot(createLot, seller.id, {
    startsAt: new Date(Date.now() + 60_000).toISOString(),
    endsAt: new Date(Date.now() + 120_000).toISOString(),
  });
  await rejects(
    placeBid({ lotId: future.id, userId: ana.id, amountCents: 100_00 }),
    'lot_not_started',
  );
});

test('saldo comprometido: líder compromete, superado libera na hora', async () => {
  const seller = await makeUser('leiloeiro');
  const ana = await makeUser('licitante', 500_00, 'ana');
  const bia = await makeUser('licitante', 500_00, 'bia');
  const lot = await liveLot(createLot, seller.id);

  await placeBid({ lotId: lot.id, userId: ana.id, amountCents: 200_00 });
  assert.deepEqual(await walletOf(ana.id), {
    totalCents: 500_00,
    committedCents: 200_00,
    availableCents: 300_00,
  });
  await placeBid({ lotId: lot.id, userId: bia.id, amountCents: 250_00 });
  assert.equal((await walletOf(ana.id)).committedCents, 0);
  assert.equal((await walletOf(bia.id)).availableCents, 250_00);
});

test('o mesmo saldo não pode ser comprometido em dois lotes (lances concorrentes)', async () => {
  const seller = await makeUser('leiloeiro');
  const ana = await makeUser('licitante', 300_00, 'ana');
  const lots = await Promise.all([1, 2, 3, 4].map(() => liveLot(createLot, seller.id)));
  const results = await Promise.allSettled(
    lots.map((l) => placeBid({ lotId: l.id, userId: ana.id, amountCents: 100_00 })),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3);
  const w = await walletOf(ana.id);
  assert.equal(w.committedCents, 300_00);
  assert.equal(w.availableCents, 0);
});

test('lances concorrentes no mesmo lote mantêm a cadeia consistente', async () => {
  const seller = await makeUser('leiloeiro');
  const users = await Promise.all(
    [1, 2, 3, 4, 5].map((i) => makeUser('licitante', 10_000_00, `u${i}`)),
  );
  const lot = await liveLot(createLot, seller.id);
  await Promise.allSettled(
    users.map((u) => placeBid({ lotId: lot.id, userId: u.id, amountCents: 100_00 })),
  );
  const {
    rows: [l],
  } = await query('SELECT * FROM lots WHERE id = $1', [lot.id]);
  const { rows: bids } = await query('SELECT * FROM bids WHERE lot_id = $1 ORDER BY seq', [lot.id]);
  assert.equal(
    bids.length,
    1,
    'só um lance de 100 pode ser aceito; os demais ficam abaixo do mínimo',
  );
  assert.deepEqual(verifyChain(l, bids), []);
});

test('anti-sniping: lance nos últimos 2 min estende o fim para +2 min', async () => {
  const seller = await makeUser('leiloeiro');
  const ana = await makeUser('licitante', 1000_00, 'ana');
  const lot = await liveLot(createLot, seller.id, {
    endsAt: new Date(Date.now() + 30_000).toISOString(),
  });
  const { extended } = await placeBid({ lotId: lot.id, userId: ana.id, amountCents: 100_00 });
  assert.equal(extended, true);
  const {
    rows: [l],
  } = await query('SELECT ends_at FROM lots WHERE id = $1', [lot.id]);
  const remaining = new Date(l.ends_at).getTime() - Date.now();
  assert.ok(remaining > 115_000 && remaining <= 120_000, `restante ${remaining}`);

  const calm = await liveLot(createLot, seller.id);
  assert.equal(
    (await placeBid({ lotId: calm.id, userId: ana.id, amountCents: 100_00 })).extended,
    false,
  );
});

async function expire(lotId) {
  // simula o fim do prazo sem esperar (starts_at precisa continuar < ends_at)
  await query(
    `UPDATE lots SET starts_at = now() - interval '2 hours', ends_at = now() - interval '1 second' WHERE id = $1`,
    [lotId],
  );
}

test('liquidação: debita vencedor, credita leiloeiro, emite comprovante; idempotente', async () => {
  const seller = await makeUser('leiloeiro');
  const ana = await makeUser('licitante', 500_00, 'ana');
  const bia = await makeUser('licitante', 500_00, 'bia');
  const lot = await liveLot(createLot, seller.id);
  await placeBid({ lotId: lot.id, userId: ana.id, amountCents: 100_00 });
  await placeBid({ lotId: lot.id, userId: bia.id, amountCents: 150_00 });
  await expire(lot.id);
  await rejects(placeBid({ lotId: lot.id, userId: ana.id, amountCents: 200_00 }), 'lot_ended');

  await settleLot(lot.id);
  await settleLot(lot.id); // segunda chamada não pode debitar de novo
  assert.deepEqual(await walletOf(bia.id), {
    totalCents: 350_00,
    committedCents: 0,
    availableCents: 350_00,
  });
  assert.equal((await walletOf(ana.id)).totalCents, 500_00);
  assert.equal((await walletOf(seller.id)).totalCents, 150_00);
  const { rows } = await query('SELECT * FROM receipts WHERE lot_id = $1', [lot.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount_cents, 150_00);
});

test('lote sem lances fecha sem vencedor e sem comprovante', async () => {
  const seller = await makeUser('leiloeiro');
  const lot = await liveLot(createLot, seller.id);
  await expire(lot.id);
  await settleLot(lot.id);
  const {
    rows: [l],
  } = await query('SELECT * FROM lots WHERE id = $1', [lot.id]);
  assert.equal(l.status, 'settled');
  assert.equal(l.winner_id, null);
  assert.equal((await query('SELECT 1 FROM receipts')).rowCount, 0);
});

test('cancelamento libera automaticamente o saldo comprometido', async () => {
  const seller = await makeUser('leiloeiro');
  const other = await makeUser('leiloeiro', 0, 'outro');
  const ana = await makeUser('licitante', 500_00, 'ana');
  const lot = await liveLot(createLot, seller.id);
  await placeBid({ lotId: lot.id, userId: ana.id, amountCents: 200_00 });
  await assert.rejects(cancelLot({ lotId: lot.id, sellerId: other.id }), (e) => e.status === 403);
  await cancelLot({ lotId: lot.id, sellerId: seller.id });
  assert.equal((await walletOf(ana.id)).availableCents, 500_00);
  await rejects(placeBid({ lotId: lot.id, userId: ana.id, amountCents: 300_00 }), 'lot_cancelled');
});

test('auditoria detecta edição, remoção e inserção direto no banco', async () => {
  const seller = await makeUser('leiloeiro');
  const ana = await makeUser('licitante', 1000_00, 'ana');
  const bia = await makeUser('licitante', 1000_00, 'bia');
  const lot = await liveLot(createLot, seller.id);
  for (const [u, v] of [
    [ana, 100],
    [bia, 120],
    [ana, 140],
  ]) {
    await placeBid({ lotId: lot.id, userId: u.id, amountCents: v * 100 });
  }
  const load = async () => ({
    lot: (await query('SELECT * FROM lots WHERE id = $1', [lot.id])).rows[0],
    bids: (await query('SELECT * FROM bids WHERE lot_id = $1 ORDER BY seq', [lot.id])).rows,
  });
  const tamper = async (sql, params = []) => {
    // o trigger append-only bloqueia o caminho comum; um superusuário o desabilita:
    await query('ALTER TABLE bids DISABLE TRIGGER bids_no_update');
    try {
      await query(sql, params);
    } finally {
      await query('ALTER TABLE bids ENABLE TRIGGER bids_no_update');
    }
  };

  let { lot: l, bids } = await load();
  assert.deepEqual(verifyChain(l, bids), [], 'íntegro no início');

  // o trigger precisa bloquear a adulteração "ingênua"
  await assert.rejects(
    query('UPDATE bids SET amount_cents = 1 WHERE lot_id = $1', [lot.id]),
    /append-only/,
  );
  await assert.rejects(query('DELETE FROM bids WHERE lot_id = $1', [lot.id]), /append-only/);

  // 1) editar o valor de um lance
  await tamper('UPDATE bids SET amount_cents = 999 WHERE lot_id = $1 AND seq = 2', [lot.id]);
  ({ lot: l, bids } = await load());
  assert.ok(verifyChain(l, bids).length > 0, 'edição detectada');
  await tamper('UPDATE bids SET amount_cents = 12000 WHERE lot_id = $1 AND seq = 2', [lot.id]);
  assert.deepEqual(
    verifyChain(...Object.values(await load())),
    [],
    'restaurado volta a ser íntegro',
  );

  // 2) remover o último lance (e ajustar a linha do lote para esconder)
  await tamper('DELETE FROM bids WHERE lot_id = $1 AND seq = 3', [lot.id]);
  ({ lot: l, bids } = await load());
  assert.ok(verifyChain(l, bids).length > 0, 'remoção do último lance detectada');
});

test('auditoria detecta remoção no meio e inserção forjada sem o segredo', async () => {
  const seller = await makeUser('leiloeiro');
  const ana = await makeUser('licitante', 1000_00, 'ana');
  const bia = await makeUser('licitante', 1000_00, 'bia');
  const lot = await liveLot(createLot, seller.id);
  for (const [u, v] of [
    [ana, 100],
    [bia, 120],
    [ana, 140],
  ]) {
    await placeBid({ lotId: lot.id, userId: u.id, amountCents: v * 100 });
  }
  await query('ALTER TABLE bids DISABLE TRIGGER bids_no_update');
  try {
    await query('DELETE FROM bids WHERE lot_id = $1 AND seq = 2', [lot.id]);
    let { rows: bids } = await query('SELECT * FROM bids WHERE lot_id = $1 ORDER BY seq', [lot.id]);
    const {
      rows: [l],
    } = await query('SELECT * FROM lots WHERE id = $1', [lot.id]);
    assert.ok(verifyChain(l, bids).length > 0, 'remoção no meio detectada');

    await query(
      `INSERT INTO bids (lot_id, seq, bidder_id, amount_cents, created_ms, prev_hash, hash)
       VALUES ($1, 4, $2, 99999, $3, $4, $5)`,
      [lot.id, ana.id, Date.now(), bids.at(-1).hash, 'f'.repeat(64)],
    );
    ({ rows: bids } = await query('SELECT * FROM bids WHERE lot_id = $1 ORDER BY seq', [lot.id]));
    assert.ok(
      verifyChain(l, bids).some((p) => /hash|Quantidade/.test(p.reason)),
      'inserção forjada detectada',
    );
  } finally {
    await query('ALTER TABLE bids ENABLE TRIGGER bids_no_update');
  }
});
