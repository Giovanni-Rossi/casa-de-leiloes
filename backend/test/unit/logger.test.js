import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, logger } from '../../src/logger.js';
import { loadConfig } from '../../src/config.js';
import { captureLogger } from '../helpers.js';

test('log estruturado: severity (GCP), message e campos de contexto', () => {
  const { logger: log, lines } = captureLogger();
  log.info({ lotId: 5, userId: 9 }, 'lance aceito');
  log.warn('atenção');
  log.error({ err: new Error('boom') }, 'falhou');

  assert.equal(lines.length, 3);
  assert.deepEqual(
    lines.map((l) => [l.severity, l.message]),
    [
      ['INFO', 'lance aceito'],
      ['WARN', 'atenção'],
      ['ERROR', 'falhou'],
    ],
  );
  assert.equal(lines[0].lotId, 5);
  assert.equal(lines[2].err.message, 'boom');
  assert.match(lines[2].err.stack, /Error: boom/);
  assert.ok(!('level' in lines[0]), 'usa severity em vez de level numérico');
  assert.equal(lines[0].service, 'casa-de-leiloes');
  assert.ok(!('pid' in lines[0]) && !('hostname' in lines[0]));
  assert.equal(new Date(lines[0].time).toISOString(), lines[0].time, 'horário em ISO 8601');
});

test('respeita o nível configurado', () => {
  const { logger: log, lines } = captureLogger('warn');
  log.info('ignorado');
  log.debug('ignorado');
  log.warn('visível');
  assert.deepEqual(
    lines.map((l) => l.message),
    ['visível'],
  );
});

test('dados sensíveis são redigidos', () => {
  const { logger: log, lines } = captureLogger();
  log.info(
    {
      req: { headers: { authorization: 'Bearer segredo', cookie: 'sid=1', accept: '*/*' } },
      body: { password: 'senha123', passwordHash: '$2a$hash', email: 'a@x.com' },
    },
    'requisição',
  );
  const out = JSON.stringify(lines[0]);
  assert.ok(!out.includes('segredo') && !out.includes('senha123') && !out.includes('$2a$hash'));
  assert.ok(!out.includes('sid=1'));
  assert.equal(lines[0].req.headers.authorization, '[REDACTED]');
  assert.equal(lines[0].req.headers.accept, '*/*', 'campos comuns continuam visíveis');
});

test('modo legível (desenvolvimento) e logger da aplicação', () => {
  const pretty = createLogger({ level: 'silent', pretty: true });
  assert.equal(typeof pretty.info, 'function');
  assert.equal(pretty.level, 'silent');
  assert.equal(logger.level, 'silent', 'nos testes o logger da aplicação é silencioso');
});

test('config do log: nível e formato por ambiente', () => {
  assert.deepEqual(
    [loadConfig({}).logLevel, loadConfig({}).logPretty],
    ['info', true],
    'desenvolvimento: info e legível',
  );
  const prod = loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'j', HASH_SECRET: 'h' });
  assert.deepEqual([prod.logLevel, prod.logPretty], ['info', false]);
  const test_ = loadConfig({ NODE_ENV: 'test' });
  assert.deepEqual([test_.logLevel, test_.logPretty], ['silent', false]);
  assert.equal(loadConfig({ LOG_LEVEL: 'debug' }).logLevel, 'debug');
  assert.equal(loadConfig({ LOG_PRETTY: 'false' }).logPretty, false);
});
