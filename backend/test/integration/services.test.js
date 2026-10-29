import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { resetDb, makeUser, liveLot, pool, query } from '../helpers.js';
import { tx, migrate } from '../../src/db.js';
import { config } from '../../src/config.js';
import {
  cancelLot,
  createLot,
  getLot,
  getVisibleLot,
  listMyBids,
  listSellerLots,
  listShowcase,
} from '../../src/services/lots.js';
import { placeBid } from '../../src/services/bidding.js';
import { settleDueLots, settleLot } from '../../src/services/settlement.js';
import { deposit, walletOf, walletWithHistory } from '../../src/services/wallet.js';
import { publicAudit, receiptByToken, roomBids } from '../../src/services/audit.js';
import { searchCatalog } from '../../src/services/catalog.js';
import { login, register, userFromAuthHeader } from '../../src/services/auth.js';
import { lotView } from '../../src/services/lotViews.js';
import { seed } from '../../src/seed.js';
import { bus } from '../../src/events.js';
import { logger } from '../../src/logger.js';

before(resetDb);
beforeEach(resetDb);
after(() => pool.end());

const code = (c) => (e) => e.code === c;
const expire = (id) =>
  query(
    `UPDATE lots SET starts_at = now() - interval '2 hours', ends_at = now() - interval '1 second' WHERE id = $1`,
    [id],
  );
const noop = { info() {}, warn() {}, error() {} };

test('db: tx faz rollback, tolera falha no ROLLBACK e migrate é idempotente', async () => {
  await assert.rejects(
    tx(async (c) => {
      await c.query(
        `INSERT INTO users (name,email,password_hash,role) VALUES ('x','x@x.com','h','licitante')`,
      );
      throw new Error('desfaz');
    }),
    /desfaz/,
  );
  assert.equal((await query('SELECT 1 FROM users')).rowCount, 0);
  // derruba a conexão no meio: o ROLLBACK também falha, mas o erro original é o propagado
  await assert.rejects(tx((c) => c.query('SELECT pg_terminate_backend(pg_backend_pid())')));
  await migrate();
  await migrate();
});

test('db: erro em conexão ociosa do pool é apenas registrado', () => {
  const log = mock.method(logger, 'error', () => {});
  pool.emit('error', new Error('conexão caiu'));
  assert.match(log.mock.calls[0].arguments[0].err.message, /conexão caiu/);
  log.mock.restore();
});

test('bidding: valor inválido, lote inexistente e fases recusadas', async () => {
  const seller = await makeUser('leiloeiro');
  const ana = await makeUser('licitante', 1000_00, 'ana');
  await assert.rejects(
    placeBid({ lotId: 1, userId: ana.id, amountCents: 0 }),
    code('invalid_amount'),
  );
  await assert.rejects(
    placeBid({ lotId: 999, userId: ana.id, amountCents: 100 }),
    code('not_found'),
  );
  const lot = await liveLot(createLot, seller.id);
  await expire(lot.id);
  await assert.rejects(
    placeBid({ lotId: lot.id, userId: ana.id, amountCents: 100_00 }),
    code('lot_ended'),
  );
});

test('settlement: lote inexistente/ainda aberto/já liquidado e falha isolada no job', async () => {
  const seller = await makeUser('leiloeiro');
  const ana = await makeUser('licitante', 500_00, 'ana');
  const bia = await makeUser('licitante', 500_00, 'bia');
  assert.equal(await settleLot(999), null);
  const open = await liveLot(createLot, seller.id);
  await placeBid({ lotId: open.id, userId: ana.id, amountCents: 100_00 });
  assert.equal(await settleLot(open.id), null, 'ainda não venceu');

  const broken = await liveLot(createLot, seller.id);
  const ok = await liveLot(createLot, seller.id);
  await placeBid({ lotId: broken.id, userId: bia.id, amountCents: 100_00 });
  await placeBid({ lotId: ok.id, userId: ana.id, amountCents: 110_00 });
  await expire(broken.id);
  await expire(ok.id);
  await query('UPDATE users SET balance_cents = 0 WHERE id = $1', [bia.id]); // viola o invariante de propósito

  const log = { error: mock.fn() };
  await settleDueLots(log);
  assert.equal(log.error.mock.callCount(), 1);
  const [fields, message] = log.error.mock.calls[0].arguments;
  assert.match(fields.err.message, /Invariante/);
  assert.equal(fields.lotId, broken.id);
  assert.equal(message, 'falha ao liquidar lote');
  assert.equal((await getLot(ok.id)).status, 'settled', 'o outro lote foi liquidado mesmo assim');
  assert.equal((await getLot(broken.id)).status, 'active');

  const silent = mock.method(logger, 'error', () => {});
  await settleDueLots();
  assert.equal(silent.mock.callCount(), 1, 'sem log injetado: usa o logger da aplicação');
  silent.mock.restore();
  assert.equal(await settleLot(ok.id), null, 'já liquidado');
});

test('lots: visibilidade, vitrine, painel do leiloeiro e meus arremates', async () => {
  const seller = await makeUser('leiloeiro');
  const other = await makeUser('leiloeiro', 0, 'outro');
  const ana = await makeUser('licitante', 900_00, 'ana');
  const bia = await makeUser('licitante', 900_00, 'bia');
  await assert.rejects(getLot(999), code('not_found'));

  const sold = await liveLot(createLot, seller.id, { title: 'Vendido' });
  const lost = await liveLot(createLot, seller.id, { title: 'Perdido' });
  const cancelled = await liveLot(createLot, seller.id, { title: 'Cancelado' });
  await placeBid({ lotId: sold.id, userId: ana.id, amountCents: 100_00 });
  await placeBid({ lotId: lost.id, userId: bia.id, amountCents: 100_00 });
  await placeBid({ lotId: lost.id, userId: ana.id, amountCents: 110_00 });
  await cancelLot({ lotId: cancelled.id, sellerId: seller.id });
  await expire(sold.id);
  await settleLot(sold.id);

  await assert.rejects(getVisibleLot(cancelled.id, other.id), code('not_found'));
  assert.equal((await getVisibleLot(cancelled.id, seller.id)).id, cancelled.id);
  assert.equal((await getVisibleLot(sold.id)).id, sold.id);

  const showcase = await listShowcase({}, null);
  assert.deepEqual(showcase.map((l) => l.title).sort(), ['Perdido', 'Vendido']);
  assert.deepEqual(
    (await listShowcase({ q: 'vendido' }, ana.id)).map((l) => l.myStatus),
    ['leading'],
  );

  const panel = await listSellerLots(seller.id);
  assert.equal(panel.totalReceivedCents, 100_00);
  assert.equal(panel.lots.length, 3);
  assert.equal((await listSellerLots(other.id)).totalReceivedCents, 0);

  const mine = await listMyBids(ana.id);
  assert.equal(mine.find((l) => l.title === 'Vendido').won, true);
  assert.ok(mine.find((l) => l.title === 'Vendido').receiptToken);
  assert.equal(mine.find((l) => l.title === 'Perdido').receiptToken, null);
  const biaBids = await listMyBids(bia.id);
  assert.equal(biaBids[0].myStatus, 'outbid');
  assert.equal(biaBids[0].won, false);
});

test('lots: criação valida entrada; cancelamento valida dono, existência e fase', async () => {
  const seller = await makeUser('leiloeiro');
  const other = await makeUser('leiloeiro', 0, 'outro');
  await assert.rejects(createLot(seller.id, { title: '' }), code('invalid_title'));
  const lot = await liveLot(createLot, seller.id);
  await assert.rejects(cancelLot({ lotId: 999, sellerId: seller.id }), code('not_found'));
  await assert.rejects(cancelLot({ lotId: lot.id, sellerId: other.id }), code('forbidden'));
  await expire(lot.id);
  await assert.rejects(cancelLot({ lotId: lot.id, sellerId: seller.id }), code('cannot_cancel'));
  await settleLot(lot.id);
  await assert.rejects(cancelLot({ lotId: lot.id, sellerId: seller.id }), code('cannot_cancel'));
});

test('lotView e broadcast: myStatus e eventos SSE', async () => {
  const seller = await makeUser('leiloeiro');
  const ana = await makeUser('licitante', 900_00, 'ana');
  const lot = await liveLot(createLot, seller.id);
  const seen = [];
  const listener = (m) => seen.push(m.event);
  bus.on(`lot:${lot.id}`, listener);
  await placeBid({ lotId: lot.id, userId: ana.id, amountCents: 100_00 });
  bus.off(`lot:${lot.id}`, listener);
  assert.deepEqual(seen, ['bid']);
  assert.equal((await lotView(await getLot(lot.id), ana.id)).myStatus, 'leading');
  assert.equal((await lotView(await getLot(lot.id), seller.id)).myStatus, 'none');
  assert.equal((await lotView(await getLot(lot.id))).myStatus, 'none');
});

test('wallet: saldo, depósito e histórico', async () => {
  const ana = await makeUser('licitante', 0, 'ana');
  await assert.rejects(walletOf(999), code('not_found'));
  // falha no registro da movimentação desfaz o crédito (mesma transação)
  await query(`ALTER TABLE transactions ADD CONSTRAINT t_no_7 CHECK (amount_cents <> 7)`);
  try {
    await assert.rejects(deposit(ana.id, 7), /t_no_7/);
  } finally {
    await query('ALTER TABLE transactions DROP CONSTRAINT t_no_7');
  }
  assert.equal((await walletOf(ana.id)).totalCents, 0, 'crédito revertido');
  assert.deepEqual(await deposit(ana.id, 250_00), {
    totalCents: 250_00,
    committedCents: 0,
    availableCents: 250_00,
  });
  const seller = await makeUser('leiloeiro');
  const lot = await liveLot(createLot, seller.id, { title: 'Peça' });
  await placeBid({ lotId: lot.id, userId: ana.id, amountCents: 100_00 });
  await expire(lot.id);
  await settleLot(lot.id);
  const h = await walletWithHistory(ana.id);
  assert.equal(h.totalCents, 150_00);
  assert.deepEqual(
    h.transactions.map((t) => [t.type, t.amountCents, t.lotTitle]),
    [
      ['debit', 100_00, 'Peça'],
      ['deposit', 250_00, null],
    ],
  );
});

test('audit: histórico público, anonimização, "mine" e comprovante', async () => {
  const seller = await makeUser('leiloeiro');
  const ana = await makeUser('licitante', 900_00, 'ana');
  const bia = await makeUser('licitante', 900_00, 'bia');
  const lot = await liveLot(createLot, seller.id);
  await placeBid({ lotId: lot.id, userId: ana.id, amountCents: 100_00 });
  await placeBid({ lotId: lot.id, userId: bia.id, amountCents: 110_00 });

  const audit = await publicAudit(lot.id);
  assert.equal(audit.intact, true);
  assert.equal(audit.bids.length, 2);
  assert.ok(!JSON.stringify(audit).includes('ana@'), 'sem dados pessoais');
  assert.match(audit.bids[0].bidder, /^Licitante [0-9A-F]{6}$/);

  const forAna = await roomBids(lot.id, ana.id);
  assert.deepEqual(
    forAna.map((b) => [b.seq, b.mine]),
    [
      [2, false],
      [1, true],
    ],
  );
  assert.deepEqual(
    (await roomBids(lot.id)).map((b) => b.mine),
    [false, false],
  );

  await expire(lot.id);
  await settleLot(lot.id);
  const {
    rows: [r],
  } = await query('SELECT token FROM receipts');
  const receipt = await receiptByToken(r.token);
  assert.equal(receipt.auditIntact, true);
  assert.equal(receipt.amountCents, 110_00);
  assert.match(receipt.seller, /^Leiloeiro /);
  assert.match(receipt.winner, /^Licitante /);
  await assert.rejects(receiptByToken('nao-existe'), code('not_found'));

  // adulteração direto no banco => comprovante e auditoria acusam
  await query('ALTER TABLE bids DISABLE TRIGGER bids_no_update');
  await query('UPDATE bids SET amount_cents = 1 WHERE lot_id = $1 AND seq = 1', [lot.id]);
  await query('ALTER TABLE bids ENABLE TRIGGER bids_no_update');
  assert.equal((await publicAudit(lot.id)).intact, false);
  assert.equal((await receiptByToken(r.token)).auditIntact, false);

  const gone = await liveLot(createLot, seller.id);
  await cancelLot({ lotId: gone.id, sellerId: seller.id });
  await assert.rejects(publicAudit(gone.id), code('not_found'));
  await assert.rejects(roomBids(gone.id), code('not_found'));
});

test('audit: comprovante inválido quando o lote não aponta mais para o hash emitido', async () => {
  const seller = await makeUser('leiloeiro');
  const ana = await makeUser('licitante', 900_00, 'ana');
  const lot = await liveLot(createLot, seller.id);
  await placeBid({ lotId: lot.id, userId: ana.id, amountCents: 100_00 });
  await expire(lot.id);
  await settleLot(lot.id);
  const {
    rows: [r],
  } = await query('SELECT token FROM receipts');
  await query(`UPDATE receipts SET head_hash = 'outro' WHERE token = $1`, [r.token]);
  assert.equal((await receiptByToken(r.token)).auditIntact, false);
});

const jsonRes = (data, ok = true, status = 200) => ({ ok, status, json: async () => data });
const item = (id, image = 'http://img/' + id) => ({
  id,
  title: `Vaso ${id}`,
  images: image ? { web: { url: image } } : {},
});

test('catálogo: API ok (filtra sem imagem e cacheia), fallback ao cache e valores padrão', async () => {
  const fetchFn = mock.fn(async () => jsonRes({ data: [item(1), item(2, null), item(3)] }));
  const ok = await searchCatalog('vaso', { fetchFn });
  assert.equal(ok.source, 'api');
  assert.deepEqual(
    ok.items.map((i) => i.externalId),
    ['1', '3'],
  );
  assert.match(String(fetchFn.mock.calls[0].arguments[0]), /q=vaso/);
  await searchCatalog('vaso', { fetchFn }); // upsert do mesmo item

  const httpError = await searchCatalog('vaso', {
    fetchFn: async () => jsonRes({}, false, 503),
    log: noop,
  });
  assert.equal(httpError.source, 'cache');
  assert.deepEqual(httpError.items.map((i) => i.externalId).sort(), ['1', '3']);

  // curingas do LIKE são literais: "%" e "_" não casam com tudo
  for (const wildcard of ['%', '_', '\\']) {
    const r = await searchCatalog(wildcard, {
      fetchFn: async () => {
        throw new Error('rede');
      },
      log: noop,
    });
    assert.deepEqual(r.items, [], `termo ${JSON.stringify(wildcard)} não pode casar com tudo`);
  }
  const down = await searchCatalog('inexistente', {
    fetchFn: async () => {
      throw new Error('rede');
    },
    log: noop,
  });
  assert.deepEqual(down, { items: [], source: 'cache' });

  const empty = await searchCatalog('x', { fetchFn: async () => jsonRes({}), log: noop });
  assert.deepEqual(empty, { items: [], source: 'api' });

  // sem dependências injetadas: usa o fetch global e o logger da aplicação
  const gf = mock.method(globalThis, 'fetch', async () => jsonRes({ data: [item(7)] }));
  assert.equal((await searchCatalog('vaso')).source, 'api');
  gf.mock.mockImplementation(async () => {
    throw new Error('off');
  });
  const warn = mock.method(logger, 'warn', () => {});
  assert.equal((await searchCatalog('vaso')).source, 'cache');
  assert.equal(warn.mock.callCount(), 1);
  gf.mock.restore();
  warn.mock.restore();
});

test('catálogo: uma nova tentativa, só para falhas passageiras', async () => {
  const networkError = () =>
    Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
  const timeoutError = () => Object.assign(new Error('aborted'), { name: 'TimeoutError' });
  const ok = () => jsonRes({ data: [item(41)] });
  // devolve, em ordem, o resultado de cada chamada (função que lança ou resposta)
  const sequence = (...steps) =>
    mock.fn(async () => {
      const step = steps.shift();
      return typeof step === 'function' ? step() : step;
    });
  const run = async (fetchFn) => {
    const log = { info: mock.fn(), warn: mock.fn() };
    const result = await searchCatalog('vaso', { fetchFn, log, retryDelayMs: 0 });
    return { result, calls: fetchFn.mock.callCount(), log };
  };
  const fail = (makeError) => () => {
    throw makeError();
  };

  // rede cai uma vez (o caso real: ECONNRESET) e volta: resultado vem da API
  let r = await run(sequence(fail(networkError), ok()));
  assert.deepEqual([r.result.source, r.calls], ['api', 2]);
  assert.equal(r.log.info.mock.callCount(), 1, 'registra a nova tentativa');
  assert.equal(r.log.warn.mock.callCount(), 0);

  // gateway instável (503) e depois ok
  r = await run(sequence(jsonRes({}, false, 503), ok()));
  assert.deepEqual([r.result.source, r.calls], ['api', 2]);

  // falha passageira duas vezes: desiste e usa o cache (só UMA nova tentativa)
  r = await run(sequence(fail(networkError), fail(networkError)));
  assert.deepEqual([r.result.source, r.calls], ['cache', 2]);
  assert.equal(r.log.warn.mock.callCount(), 1);

  // não são passageiras: sem nova tentativa
  for (const step of [
    jsonRes({}, false, 404), // erro do cliente
    fail(timeoutError), // timeout: tentar de novo dobraria a espera
    fail(() => new TypeError('outro erro')), // TypeError que não é de rede
  ]) {
    r = await run(sequence(step, ok()));
    assert.deepEqual([r.result.source, r.calls], ['cache', 1]);
  }

  // espera padrão entre as tentativas (sem retryDelayMs)
  const started = Date.now();
  const res = await searchCatalog('vaso', {
    fetchFn: sequence(fail(networkError), ok()),
    log: noop,
  });
  assert.equal(res.source, 'api');
  assert.ok(Date.now() - started >= 250, 'aguarda antes de tentar de novo');
});

test('auth: cadastro, login e resolução do token', async () => {
  const reg = await register({
    name: 'Ana',
    email: 'ANA@x.com',
    password: '123456',
    role: 'licitante',
  });
  assert.deepEqual(reg.user, {
    id: reg.user.id,
    name: 'Ana',
    email: 'ana@x.com',
    role: 'licitante',
  });
  await assert.rejects(
    register({ name: 'Ana', email: 'ana@x.com', password: '123456', role: 'licitante' }),
    code('email_taken'),
  );
  await assert.rejects(register({ name: '' }), code('invalid_name'));
  await assert.rejects(
    query(
      `INSERT INTO users (name,email,password_hash,role) VALUES (NULL,'z@z.com','h','licitante')`,
    ),
  ); // erro não-duplicidade segue o caminho normal

  assert.equal((await login({ email: ' ana@X.com ', password: '123456' })).user.name, 'Ana');
  await assert.rejects(
    login({ email: 'ana@x.com', password: 'errada' }),
    code('invalid_credentials'),
  );
  await assert.rejects(
    login({ email: 'nao@x.com', password: '123456' }),
    code('invalid_credentials'),
  );
  await assert.rejects(login({}), code('invalid_credentials'));

  assert.equal((await userFromAuthHeader(`Bearer ${reg.token}`)).id, reg.user.id);
  assert.equal(await userFromAuthHeader(), null);
  assert.equal(await userFromAuthHeader('Basic abc'), null);
  assert.equal(await userFromAuthHeader('Bearer lixo'), null);
  assert.equal(
    await userFromAuthHeader(`Bearer ${jwt.sign({ sub: 99999 }, config.jwtSecret)}`),
    null,
  );
});

test('register propaga erros inesperados do banco', async () => {
  const spy = mock.method(pool, 'query', async () => {
    throw Object.assign(new Error('db off'), { code: 'XX000' });
  });
  await assert.rejects(
    register({ name: 'A', email: 'a@x.com', password: '123456', role: 'licitante' }),
    /db off/,
  );
  spy.mock.restore();
});

test('logs de eventos de negócio (sem dados pessoais)', async () => {
  const info = mock.method(logger, 'info', () => {});
  const warn = mock.method(logger, 'warn', () => {});
  const events = () => info.mock.calls.map((c) => [c.arguments[1], c.arguments[0]]);
  try {
    const reg = await register({
      name: 'Ana',
      email: 'ana@x.com',
      password: '123456',
      role: 'licitante',
    });
    const seller = await makeUser('leiloeiro');
    const lot = await liveLot(createLot, seller.id);
    await deposit(reg.user.id, 500_00);
    await placeBid({ lotId: lot.id, userId: reg.user.id, amountCents: 100_00 });
    await expire(lot.id);
    await settleLot(lot.id);
    const other = await liveLot(createLot, seller.id);
    await cancelLot({ lotId: other.id, sellerId: seller.id });

    const byMessage = Object.fromEntries(events().map(([m, f]) => [m, f]));
    assert.deepEqual(byMessage['usuário cadastrado'], { userId: reg.user.id, role: 'licitante' });
    assert.equal(byMessage['lote criado'].lotId, other.id);
    assert.deepEqual(
      { ...byMessage['lance aceito'] },
      { lotId: lot.id, userId: reg.user.id, amountCents: 100_00, seq: 1, extended: false },
    );
    assert.deepEqual(byMessage['lote liquidado'], { lotId: lot.id, sold: true });
    assert.deepEqual(byMessage['lote cancelado'], { lotId: other.id, sellerId: seller.id });
    assert.ok(!JSON.stringify(events()).includes('ana@x.com'), 'e-mail não vai para o log');

    await assert.rejects(login({ email: 'ana@x.com', password: 'errada' }));
    await assert.rejects(login({ email: 'ninguem@x.com', password: 'x' }));
    assert.deepEqual(
      warn.mock.calls.map((c) => [c.arguments[1], c.arguments[0].userId]),
      [
        ['tentativa de login recusada', reg.user.id],
        ['tentativa de login recusada', null],
      ],
    );
  } finally {
    info.mock.restore();
    warn.mock.restore();
  }
});

test('seed: cria dados de teste e é idempotente', async () => {
  await seed();
  await seed();
  assert.equal((await query('SELECT 1 FROM users')).rowCount, 3);
  const lots = await listShowcase({});
  assert.deepEqual(lots.map((l) => l.phase).sort(), ['live', 'scheduled']);
  const live = lots.find((l) => l.phase === 'live');
  assert.equal(live.bidCount, 2);
  assert.ok(new Date(live.endsAt) - Date.now() > 29 * 24 * 3_600_000, 'fica ao vivo por ~30 dias');
  assert.equal((await publicAudit(live.id)).intact, true);
});

test('seed: num banco antigo cujo lote demo já encerrou, recria um lote ao vivo com lances', async () => {
  await seed();
  const liveNow = async () => (await listShowcase({ phase: 'live' })).filter((l) => l.bidCount);
  const [first] = await liveNow();
  // ainda ao vivo, mas acabando em 1 h: não serve como lote de demonstração
  await query(`UPDATE lots SET ends_at = now() + interval '1 hour' WHERE id = $1`, [first.id]);

  await seed();
  const again = (await liveNow()).find((l) => l.id !== first.id);
  assert.ok(again, 'novo lote demo criado');
  assert.equal(again.bidCount, 2);
  await seed();
  assert.equal((await liveNow()).length, 2, 'com um lote duradouro, não cria outro');
  assert.equal((await query('SELECT 1 FROM users')).rowCount, 3, 'não duplica contas');

  // contas demo sem saldo: o lote é criado sem lances e a subida não falha
  await expire(again.id);
  await query(`UPDATE users SET balance_cents = 0 WHERE email = 'ana@teste.com'`);
  await seed();
  const created = (await listShowcase({ phase: 'live' })).filter((l) => l.bidCount === 0);
  assert.equal(created.length, 1);
});
