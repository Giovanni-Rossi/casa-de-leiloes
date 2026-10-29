import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  errorHandler,
  intParam,
  notFoundHandler,
  requireAuth,
  wrap,
} from '../../src/http/middleware.js';
import { HttpError } from '../../src/errors.js';
import { bus, emitGlobal, emitLot, sseHandler } from '../../src/events.js';
import { config, loadConfig } from '../../src/config.js';
import { startSettlementJob } from '../../src/jobs/settlementJob.js';

const fakeRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
};

test('intParam aceita inteiros positivos e rejeita o resto com 404', () => {
  assert.equal(intParam('12'), 12);
  for (const v of ['0', '-3', '1.5', 'abc', undefined]) {
    assert.throws(
      () => intParam(v),
      (e) => e.status === 404,
    );
  }
});

test('wrap encaminha erros síncronos e assíncronos para next', async () => {
  const errors = [];
  const next = (e) => errors.push(e);
  await wrap(async () => {
    throw new Error('async');
  })({}, {}, next);
  await wrap(() => {
    throw new Error('sync');
  })({}, {}, next);
  await wrap(async () => 'ok')({}, {}, next);
  assert.deepEqual(
    errors.map((e) => e.message),
    ['async', 'sync'],
  );
});

test('requireAuth: 401 sem usuário, 403 com perfil errado, passa quando permitido', () => {
  const run = (req, role) => {
    let got;
    requireAuth(role)(req, {}, (e) => {
      got = e;
    });
    return got;
  };
  assert.equal(run({}, 'licitante').status, 401);
  assert.equal(run({ user: { role: 'leiloeiro' } }, 'licitante').status, 403);
  assert.match(run({ user: { role: 'leiloeiro' } }, 'licitante').message, /licitantes/);
  assert.match(run({ user: { role: 'licitante' } }, 'leiloeiro').message, /leiloeiros/);
  assert.equal(run({ user: { role: 'licitante' } }, 'licitante'), undefined);
  assert.equal(run({ user: { role: 'qualquer' } }), undefined); // sem papel exigido
});

test('notFoundHandler e errorHandler', () => {
  let err;
  notFoundHandler({}, {}, (e) => {
    err = e;
  });
  assert.equal(err.status, 404);

  const req = { log: { error: mock.fn() }, user: { id: 7 } };
  let res = fakeRes();
  errorHandler(new HttpError(422, 'x', 'msg'), req, res);
  assert.deepEqual([res.statusCode, res.body], [422, { error: { code: 'x', message: 'msg' } }]);
  assert.equal(req.log.error.mock.callCount(), 0, 'erros de negócio não são "erro inesperado"');

  res = fakeRes();
  errorHandler(Object.assign(new Error('bad'), { type: 'entity.parse.failed' }), req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'invalid_json');

  res = fakeRes();
  const boom = new Error('boom');
  errorHandler(boom, req, res);
  assert.deepEqual([res.statusCode, res.body.error.code], [500, 'internal']);
  assert.deepEqual(req.log.error.mock.calls[0].arguments, [
    { err: boom, userId: 7 },
    'erro inesperado',
  ]);

  errorHandler(boom, { log: req.log }, fakeRes()); // sem usuário autenticado
  assert.equal(req.log.error.mock.calls[1].arguments[0].userId, undefined);
});

function fakeSse() {
  const req = new EventEmitter();
  const res = { headers: null, chunks: [], flushed: false };
  res.set = (h) => {
    res.headers = h;
  };
  res.flushHeaders = () => {
    res.flushed = true;
  };
  res.write = (c) => res.chunks.push(c);
  return { req, res };
}

test('SSE: envia hello inicial, eventos do canal e heartbeat; limpa ao fechar', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const { req, res } = fakeSse();
    await sseHandler(
      () => 'lot:42',
      async () => ({ ok: 1 }),
    )(req, res);
    assert.equal(res.headers['Content-Type'], 'text/event-stream');
    assert.ok(res.flushed);
    assert.match(res.chunks[0], /^event: hello\ndata: {"ok":1}\n\n$/);

    emitLot(42, 'bid', { n: 1 });
    emitLot(43, 'bid', { n: 2 }); // outro lote: ignorado
    assert.match(res.chunks[1], /event: bid\ndata: {"n":1}/);
    assert.equal(res.chunks.length, 2);

    mock.timers.tick(20000);
    assert.equal(res.chunks[2], ': ping\n\n');

    req.emit('close');
    emitLot(42, 'bid', { n: 3 });
    mock.timers.tick(20000);
    assert.equal(res.chunks.length, 3, 'após fechar, nada mais é escrito');
    assert.equal(bus.listenerCount('lot:42'), 0);
  } finally {
    mock.timers.reset();
  }
});

test('SSE sem mensagem inicial e canal global', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const { req, res } = fakeSse();
    await sseHandler(() => 'global')(req, res);
    assert.equal(res.chunks.length, 0);
    emitGlobal('lot', { a: 1 });
    assert.match(res.chunks[0], /event: lot/);
    req.emit('close');
  } finally {
    mock.timers.reset();
  }
});

test('job de liquidação: executa, não sobrepõe e registra falhas', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    let release;
    const settle = mock.fn(
      () =>
        new Promise((r) => {
          release = r;
        }),
    );
    const log = { error: mock.fn() };
    const stop = startSettlementJob(1000, { settle, log });

    mock.timers.tick(1000);
    mock.timers.tick(1000); // 1ª execução ainda em andamento -> ignorada
    assert.equal(settle.mock.callCount(), 1);
    release();
    await new Promise((r) => setImmediate(r));
    mock.timers.tick(1000);
    assert.equal(settle.mock.callCount(), 2);

    settle.mock.mockImplementation(async () => {
      throw new Error('falhou');
    });
    release();
    await new Promise((r) => setImmediate(r));
    mock.timers.tick(1000);
    await new Promise((r) => setImmediate(r));
    assert.equal(log.error.mock.callCount(), 1);

    stop();
    mock.timers.tick(5000);
    assert.equal(settle.mock.callCount(), 3, 'parado: não executa mais');
  } finally {
    mock.timers.reset();
  }
});

test('job de liquidação com dependências padrão', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const stop = startSettlementJob(1000);
    assert.equal(typeof stop, 'function');
    stop();
  } finally {
    mock.timers.reset();
  }
});

test('config: exige segredos em produção e lê variáveis de ambiente', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /JWT_SECRET/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'j' }), /HASH_SECRET/);
  const prod = loadConfig({
    NODE_ENV: 'production',
    JWT_SECRET: 'j',
    HASH_SECRET: 'h',
    PORT: '4000',
    DATABASE_URL: 'postgres://x',
  });
  assert.deepEqual(
    [prod.isProd, prod.port, prod.jwtSecret, prod.hashSecret, prod.databaseUrl],
    [true, 4000, 'j', 'h', 'postgres://x'],
  );
  const dev = loadConfig({});
  assert.deepEqual(
    [dev.isProd, dev.port, dev.jwtSecret, dev.hashSecret],
    [false, 3001, 'dev-jwt-secret', 'dev-hash-secret'],
  );
  assert.match(dev.databaseUrl, /^postgres:\/\//);
  assert.equal(config.antiSnipingMs, 120000);
});
