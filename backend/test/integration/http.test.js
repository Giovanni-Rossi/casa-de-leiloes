import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resetDb, pool, query, captureLogger } from '../helpers.js';
import { createApp } from '../../src/http/app.js';
import { start } from '../../src/server.js';

const publicDir = mkdtempSync(path.join(tmpdir(), 'spa-'));
writeFileSync(path.join(publicDir, 'index.html'), '<html>SPA</html>');

let server, base;
const fetchFn = async () => ({
  ok: true,
  json: async () => ({ data: [{ id: 1, title: 'Vaso', images: { web: { url: 'http://i' } } }] }),
});
const catalogDeps = { fetchFn, log: { warn() {} } };

before(async () => {
  await resetDb();
  server = createApp({ publicDir, catalogDeps, log: captureLogger('silent').logger }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
beforeEach(() =>
  query('TRUNCATE receipts, transactions, lots, catalog_items, users RESTART IDENTITY CASCADE'),
);
after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end();
});

async function call(method, url, { token, body, raw } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(body || raw ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html */
  }
  return { status: res.status, json, text };
}
const signup = async (role, name = role) =>
  (
    await call('POST', '/api/auth/register', {
      body: { name, email: `${name}@t.com`, password: '123456', role },
    })
  ).json;
const inHours = (h) => new Date(Date.now() + h * 3600_000).toISOString();
const lotBody = (over = {}) => ({
  title: 'Vaso',
  startingBidCents: 10000,
  minIncrementCents: 1000,
  startsAt: inHours(-1),
  endsAt: inHours(1),
  ...over,
});

test('saúde, SPA, fallback de rotas e 404 da API', async () => {
  assert.deepEqual((await call('GET', '/api/health')).json, { ok: true });
  assert.match((await call('GET', '/')).text, /SPA/);
  assert.match((await call('GET', '/lotes/1')).text, /SPA/);
  const r = await call('GET', '/api/nao-existe');
  assert.equal(r.status, 404);
  assert.equal(r.json.error.code, 'not_found');
});

test('app sem build do front: só a API', async () => {
  for (const opts of [{}, { publicDir: '/caminho/que/nao/existe' }]) {
    const s = createApp({ ...opts, log: captureLogger('silent').logger }).listen(0);
    await new Promise((r) => s.once('listening', r));
    const res = await fetch(`http://localhost:${s.address().port}/`);
    assert.equal(res.status, 404);
    s.close();
  }
  assert.ok(createApp()); // log padrão
});

test('JSON inválido => 400; erro inesperado => 500 sem vazar detalhes', async () => {
  const bad = await call('POST', '/api/auth/login', { raw: '{oops' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, 'invalid_json');

  const spy = mock.method(pool, 'query', async () => {
    throw new Error('segredo interno');
  });
  const boom = await call('GET', '/api/lots');
  spy.mock.restore();
  assert.equal(boom.status, 500);
  assert.ok(!boom.text.includes('segredo'));
});

test('auth: cadastro, login, /me e validações', async () => {
  const reg = await call('POST', '/api/auth/register', {
    body: { name: 'Ana', email: 'a@x.com', password: '123456', role: 'licitante' },
  });
  assert.equal(reg.status, 201);
  assert.equal(
    (
      await call('POST', '/api/auth/register', {
        body: { name: 'Ana', email: 'a@x.com', password: '123456', role: 'licitante' },
      })
    ).status,
    409,
  );
  assert.equal((await call('POST', '/api/auth/register', { body: {} })).status, 400);
  const login = await call('POST', '/api/auth/login', {
    body: { email: 'a@x.com', password: '123456' },
  });
  assert.equal(login.status, 200);
  assert.equal(
    (await call('POST', '/api/auth/login', { body: { email: 'a@x.com', password: 'x' } })).status,
    401,
  );
  assert.equal((await call('POST', '/api/auth/login', { body: { email: 'a@x.com' } })).status, 401);
  assert.equal(
    (await call('GET', '/api/auth/me', { token: login.json.token })).json.user.email,
    'a@x.com',
  );
  assert.equal((await call('GET', '/api/auth/me')).status, 401);
  assert.equal((await call('GET', '/api/auth/me', { token: 'lixo' })).status, 401);
});

test('fluxo completo: leiloeiro cria lote, licitantes disputam, comprovante e auditoria públicos', async () => {
  const seller = await signup('leiloeiro');
  const ana = await signup('licitante', 'ana');
  const bia = await signup('licitante', 'bia');
  for (const u of [ana, bia])
    assert.equal(
      (await call('POST', '/api/wallet/deposit', { token: u.token, body: { amountCents: 100000 } }))
        .status,
      201,
    );

  // busca no catálogo (só leiloeiro) e criação do lote
  assert.equal((await call('GET', '/api/catalog/search?q=vaso', { token: ana.token })).status, 403);
  assert.equal((await call('GET', '/api/catalog/search?q=', { token: seller.token })).status, 400);
  assert.equal((await call('GET', '/api/catalog/search', { token: seller.token })).status, 400);
  const found = await call('GET', '/api/catalog/search?q=vaso', { token: seller.token });
  assert.equal(found.json.source, 'api');
  assert.equal(found.json.items[0].title, 'Vaso');

  assert.equal(
    (await call('POST', '/api/lots', { token: seller.token, body: lotBody({ title: '' }) })).status,
    400,
  );
  assert.equal(
    (await call('POST', '/api/lots', { token: ana.token, body: lotBody() })).status,
    403,
  );
  const created = await call('POST', '/api/lots', {
    token: seller.token,
    body: lotBody({ ...found.json.items[0] }),
  });
  assert.equal(created.status, 201);
  const id = created.json.lot.id;

  // vitrine pública com filtros
  const showcase = await call('GET', '/api/lots?phase=live&q=vaso&minCents=1&maxCents=999999');
  assert.deepEqual(
    showcase.json.lots.map((l) => l.id),
    [id],
  );
  assert.equal((await call('GET', '/api/lots?phase=scheduled')).json.lots.length, 0);
  assert.equal(
    (await call('GET', '/api/lots', { token: ana.token })).json.lots[0].myStatus,
    'none',
  );
  assert.equal(
    (await call('GET', `/api/lots/${id}`, { token: ana.token })).json.lot.myStatus,
    'none',
  );

  // lances: recusas com código e aceitos
  const bid = (u, amountCents) =>
    call('POST', `/api/lots/${id}/bids`, { token: u.token, body: { amountCents } });
  assert.equal((await bid(seller, 20000)).status, 403);
  assert.equal(
    (await call('POST', `/api/lots/${id}/bids`, { body: { amountCents: 20000 } })).status,
    401,
  );
  assert.equal((await bid(ana, 5000)).json.error.code, 'below_minimum');
  assert.equal((await bid(ana, 99999999)).json.error.code, 'insufficient_funds');
  assert.equal((await bid(ana, 10000)).status, 201);
  assert.equal((await bid(ana, 20000)).json.error.code, 'already_leading');
  assert.equal((await bid(bia, 11000)).status, 201);
  assert.equal(
    (await call('POST', `/api/lots/abc/bids`, { token: ana.token, body: { amountCents: 1 } }))
      .status,
    404,
  );

  const room = await call('GET', `/api/lots/${id}/bids`, { token: ana.token });
  assert.deepEqual(
    room.json.bids.map((b) => [b.seq, b.mine]),
    [
      [2, false],
      [1, true],
    ],
  );
  assert.equal(
    (await call('GET', `/api/lots/${id}`, { token: ana.token })).json.lot.myStatus,
    'outbid',
  );
  const wallet = await call('GET', '/api/wallet', { token: bia.token });
  assert.deepEqual([wallet.json.committedCents, wallet.json.availableCents], [11000, 89000]);
  assert.equal((await call('GET', '/api/wallet')).status, 401);
  assert.equal(
    (await call('POST', '/api/wallet/deposit', { token: ana.token, body: { amountCents: -5 } }))
      .status,
    400,
  );
  assert.equal(
    (
      await call('POST', '/api/wallet/deposit', {
        token: ana.token,
        body: { amountCents: 10 ** 12 },
      })
    ).status,
    400,
  );

  // encerra e liquida
  await query(
    `UPDATE lots SET starts_at = now() - interval '2 hours', ends_at = now() - interval '1 second'`,
  );
  const { settleDueLots } = await import('../../src/services/settlement.js');
  await settleDueLots();

  const mine = await call('GET', '/api/my/bids', { token: bia.token });
  assert.equal(mine.json.lots[0].won, true);
  assert.equal((await call('GET', '/api/my/bids', { token: seller.token })).status, 403);
  const panel = await call('GET', '/api/seller/lots', { token: seller.token });
  assert.equal(panel.json.totalReceivedCents, 11000);
  assert.equal((await call('GET', '/api/seller/lots', { token: ana.token })).status, 403);

  // público, sem login
  const receipt = await call('GET', `/api/receipts/${mine.json.lots[0].receiptToken}`);
  assert.equal(receipt.json.receipt.auditIntact, true);
  assert.equal((await call('GET', '/api/receipts/inexistente')).status, 404);
  const audit = await call('GET', `/api/audit/${id}`);
  assert.deepEqual([audit.json.intact, audit.json.bids.length], [true, 2]);
  assert.equal((await call('GET', '/api/audit/0')).status, 404);
});

test('cancelamento via API e visibilidade de lote cancelado', async () => {
  const seller = await signup('leiloeiro');
  const other = await signup('leiloeiro', 'outro');
  const id = (await call('POST', '/api/lots', { token: seller.token, body: lotBody() })).json.lot
    .id;
  assert.equal((await call('POST', `/api/lots/${id}/cancel`, { token: other.token })).status, 403);
  assert.equal(
    (await call('POST', `/api/lots/${id}/cancel`, { token: seller.token })).json.ok,
    true,
  );
  assert.equal((await call('GET', `/api/lots/${id}`)).status, 404);
  assert.equal((await call('GET', `/api/lots/${id}`, { token: seller.token })).status, 200);
  assert.equal((await call('GET', '/api/lots')).json.lots.length, 0);
  assert.equal((await call('POST', `/api/lots/${id}/cancel`, { token: seller.token })).status, 422);
});

test('SSE: lote e vitrine recebem eventos em tempo real', async () => {
  const seller = await signup('leiloeiro');
  const ana = await signup('licitante', 'ana');
  await call('POST', '/api/wallet/deposit', { token: ana.token, body: { amountCents: 100000 } });
  const id = (await call('POST', '/api/lots', { token: seller.token, body: lotBody() })).json.lot
    .id;

  const listen = async (url) => {
    const ctl = new AbortController();
    const res = await fetch(base + url, { signal: ctl.signal });
    assert.match(res.headers.get('content-type'), /^text\/event-stream/);
    const reader = res.body.getReader();
    return {
      async next() {
        return new TextDecoder().decode((await reader.read()).value);
      },
      close: () => ctl.abort(),
    };
  };
  const lotStream = await listen(`/api/lots/${id}/stream`);
  const globalStream = await listen('/api/stream');
  await new Promise((r) => setTimeout(r, 100));
  await call('POST', `/api/lots/${id}/bids`, { token: ana.token, body: { amountCents: 10000 } });
  assert.match(await lotStream.next(), /event: bid/);
  assert.match(await globalStream.next(), /event: lot/);
  lotStream.close();
  globalStream.close();
});

test('server.start: migra, semeia, atende e liquida pelo job; stop encerra tudo', async () => {
  await query(
    'TRUNCATE receipts, transactions, lots, catalog_items, users RESTART IDENTITY CASCADE',
  );
  const app = await start({ port: 0, autoSeed: true });
  const url = `http://localhost:${app.server.address().port}`;
  assert.deepEqual(await (await fetch(`${url}/api/health`)).json(), { ok: true });
  const lots = await (await fetch(`${url}/api/lots?phase=live`)).json();
  assert.equal(lots.lots.length, 1);
  await app.stop();

  const noSeed = await start({ port: 0, autoSeed: false });
  await noSeed.stop();
  const defaults = await start({ port: 0 });
  await defaults.stop();
});

test('log de requisições: id de correlação, nível por status e o que fica de fora', async () => {
  const { logger: log, lines } = captureLogger();
  const s = createApp({ publicDir, log }).listen(0);
  await new Promise((r) => s.once('listening', r));
  const url = `http://localhost:${s.address().port}`;
  const get = (p, headers) => fetch(url + p, { headers });
  const requests = () => lines.filter((l) => l.req);

  // 200 => info; cria um id e o devolve no cabeçalho
  const ok = await get('/api/lots');
  const generated = ok.headers.get('x-request-id');
  assert.match(generated, /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    [requests()[0].severity, requests()[0].req.id, requests()[0].res.statusCode],
    ['INFO', generated, 200],
  );
  assert.deepEqual(Object.keys(requests()[0].req).sort(), ['id', 'method', 'url']);

  // id do cliente é respeitado (e limitado a 64 caracteres)
  const mine = await get('/api/lots', { 'x-request-id': 'abc-123' });
  assert.equal(mine.headers.get('x-request-id'), 'abc-123');
  const long = await get('/api/lots', { 'x-request-id': 'x'.repeat(200) });
  assert.equal(long.headers.get('x-request-id').length, 64);

  // 4xx => warn; Authorization nunca aparece no log
  await get('/api/auth/me', { authorization: 'Bearer token-secreto-123' });
  const unauthorized = requests().find((l) => l.res.statusCode === 401);
  assert.equal(unauthorized.severity, 'WARN');
  assert.ok(!JSON.stringify(lines).includes('token-secreto-123'));

  // 5xx => error, com o erro e o id da requisição
  const spy = mock.method(pool, 'query', async () => {
    throw new Error('banco caiu');
  });
  const boom = await get('/api/lots', { 'x-request-id': 'req-500' });
  spy.mock.restore();
  assert.equal(boom.status, 500);
  const unexpected = lines.find((l) => l.message === 'erro inesperado');
  assert.equal(unexpected.severity, 'ERROR');
  assert.equal(unexpected.err.message, 'banco caiu');
  assert.equal(unexpected.req.id, 'req-500');
  assert.equal(lines.find((l) => l.res?.statusCode === 500).severity, 'ERROR');

  // fora do log: health check e arquivos estáticos
  const before = lines.length;
  await get('/api/health');
  await get('/');
  await get('/lotes/1');
  assert.equal(lines.length, before);
  s.close();
});
