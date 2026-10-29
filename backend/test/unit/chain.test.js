import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  anchorMac,
  bidHash,
  GENESIS_HASH,
  pseudonym,
  verifyChain,
} from '../../src/domain/chain.js';

const base = {
  lotId: 1,
  seq: 1,
  bidderId: 7,
  amountCents: 100,
  createdMs: 1000,
  prevHash: GENESIS_HASH,
};

/** Monta uma cadeia válida de lances + a linha de lote correspondente. */
function buildChain(amounts = [100, 200, 300]) {
  const bids = [];
  let prev = GENESIS_HASH;
  amounts.forEach((amountCents, i) => {
    const b = {
      seq: i + 1,
      bidder_id: (i % 2) + 1,
      amount_cents: amountCents,
      created_ms: 1000 + i,
      prev_hash: prev,
    };
    b.hash = bidHash({
      lotId: 1,
      seq: b.seq,
      bidderId: b.bidder_id,
      amountCents,
      createdMs: b.created_ms,
      prevHash: prev,
    });
    prev = b.hash;
    bids.push(b);
  });
  const last = bids.at(-1);
  const lot = {
    id: 1,
    bid_count: bids.length,
    head_hash: last?.hash ?? null,
    current_bid_cents: last?.amount_cents ?? null,
    leader_id: last?.bidder_id ?? null,
    anchor_mac: anchorMac({ lotId: 1, bidCount: bids.length, headHash: last?.hash ?? null }),
  };
  return { lot, bids };
}

test('bidHash é determinístico e sensível a cada campo', () => {
  assert.equal(bidHash(base), bidHash({ ...base }));
  assert.match(bidHash(base), /^[0-9a-f]{64}$/);
  for (const [k, v] of Object.entries({
    lotId: 2,
    seq: 2,
    bidderId: 8,
    amountCents: 101,
    createdMs: 1001,
    prevHash: 'a'.repeat(64),
  })) {
    assert.notEqual(bidHash({ ...base, [k]: v }), bidHash(base), `campo ${k} deve alterar o hash`);
  }
});

test('pseudônimo: estável, anônimo e diferente por lote', () => {
  assert.equal(pseudonym(1, 5), pseudonym(1, 5));
  assert.notEqual(pseudonym(1, 5), pseudonym(2, 5));
  assert.notEqual(pseudonym(1, 5), pseudonym(1, 6));
  assert.match(pseudonym(1, 5), /^Licitante [0-9A-F]{6}$/);
  assert.ok(!pseudonym(1, 5).includes('5 '));
});

test('verifyChain: cadeia íntegra e lote sem lances', () => {
  const { lot, bids } = buildChain();
  assert.deepEqual(verifyChain(lot, bids), []);
  const empty = buildChain([]);
  assert.deepEqual(verifyChain(empty.lot, empty.bids), []);
});

test('verifyChain: edição de valor', () => {
  const { lot, bids } = buildChain();
  bids[1].amount_cents = 999;
  const problems = verifyChain(lot, bids);
  assert.ok(problems.some((p) => p.seq === 2 && /alterado/.test(p.reason)));
});

test('verifyChain: remoção no meio', () => {
  const { lot, bids } = buildChain();
  const problems = verifyChain(lot, [bids[0], bids[2]]);
  assert.ok(problems.some((p) => /Sequência/.test(p.reason)));
  assert.ok(problems.some((p) => /Elo anterior/.test(p.reason)));
  assert.ok(problems.some((p) => /Quantidade/.test(p.reason)));
});

test('verifyChain: remoção do último lance diverge da âncora', () => {
  const { lot, bids } = buildChain();
  const problems = verifyChain(lot, bids.slice(0, 2));
  assert.ok(problems.some((p) => /Quantidade/.test(p.reason)));
  assert.ok(problems.some((p) => /Hash final/.test(p.reason)));
  assert.ok(problems.some((p) => /Lance vencedor/.test(p.reason)));
});

test('verifyChain: lance/líder do lote não bate com o último lance', () => {
  const { lot, bids } = buildChain();
  assert.ok(
    verifyChain({ ...lot, current_bid_cents: 1 }, bids).some((p) =>
      /Lance vencedor/.test(p.reason),
    ),
  );
  assert.ok(
    verifyChain({ ...lot, leader_id: 99 }, bids).some((p) => /Lance vencedor/.test(p.reason)),
  );
});

test('anchorMac: determinístico e sensível a lote, contagem e hash final', () => {
  const a = { lotId: 1, bidCount: 2, headHash: 'a'.repeat(64) };
  assert.equal(anchorMac(a), anchorMac({ ...a }));
  assert.match(anchorMac(a), /^[0-9a-f]{64}$/);
  for (const [k, v] of Object.entries({ lotId: 2, bidCount: 3, headHash: 'b'.repeat(64) }))
    assert.notEqual(anchorMac({ ...a, [k]: v }), anchorMac(a), `campo ${k} deve alterar o MAC`);
  // lote sem lances: head_hash nulo equivale ao gênese
  assert.equal(
    anchorMac({ lotId: 1, bidCount: 0, headHash: null }),
    anchorMac({ lotId: 1, bidCount: 0, headHash: GENESIS_HASH }),
  );
});

test('verifyChain: último lance removido com a âncora "rebobinada" (sem o segredo)', () => {
  const { lot, bids } = buildChain();
  // quem só tem o banco consegue copiar os dados do lance anterior para a linha do lote…
  const rewound = {
    ...lot,
    bid_count: 2,
    head_hash: bids[1].hash,
    current_bid_cents: bids[1].amount_cents,
    leader_id: bids[1].bidder_id,
  };
  const problems = verifyChain(rewound, bids.slice(0, 2));
  // …mas não recalcular o MAC da âncora
  assert.deepEqual(
    problems.map((p) => p.reason),
    ['Assinatura da âncora do lote não confere — registro do lote alterado no banco'],
  );
  assert.ok(verifyChain({ ...lot, anchor_mac: null }, bids).length > 0, 'âncora sem assinatura');
  assert.deepEqual(verifyChain(rewound, bids.slice(0, 2), { anchor: false }), []);
});

test('verifyChain: lote com âncora mas sem lances (todos removidos)', () => {
  const { lot } = buildChain();
  const problems = verifyChain(lot, []);
  assert.ok(problems.some((p) => /Quantidade/.test(p.reason)));
  assert.ok(problems.some((p) => /Hash final/.test(p.reason)));
});
