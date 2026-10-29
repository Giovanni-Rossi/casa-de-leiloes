import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../../src/', import.meta.url));
const filesIn = (dir) =>
  readdirSync(path.join(src, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesIn(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
const read = (f) => readFileSync(path.join(src, f), 'utf8');

const SQL = /\b(SELECT\s.+\sFROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/is;

test('só os repositórios contêm SQL (domínio, serviços e HTTP não)', () => {
  for (const f of [
    ...filesIn('domain'),
    ...filesIn('services'),
    ...filesIn('http'),
    ...filesIn('jobs'),
    'seed.js',
  ]) {
    assert.ok(!SQL.test(read(f)), `${f} contém SQL — mova para src/repositories/`);
  }
  assert.ok(
    filesIn('repositories').every((f) => SQL.test(read(f))),
    'todo repositório deve conter SQL',
  );
});

test('o domínio é puro: não importa banco, serviços nem HTTP', () => {
  for (const f of filesIn('domain')) {
    const imports = [...read(f).matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    for (const i of imports)
      assert.ok(!/(db|repositories|services|http|events)\b/.test(i), `${f} importa ${i}`);
  }
});

test('a camada HTTP não acessa repositórios diretamente (passa pelos serviços)', () => {
  for (const f of filesIn('http'))
    assert.ok(!/repositories\//.test(read(f)), `${f} importa um repositório`);
});

test('anti SQL injection: nenhum SQL é montado com interpolação ou concatenação', () => {
  const TEMPLATE = /`([^`]*)`/gs;
  for (const f of filesIn('repositories')) {
    const code = read(f);
    for (const [, body] of code.matchAll(TEMPLATE)) {
      if (SQL.test(body))
        assert.ok(!body.includes('${'), `${f}: interpolação em SQL — use parâmetros ($1, $2…)`);
    }
    assert.ok(
      !/(SELECT|INSERT|UPDATE|DELETE)[^;]*['"`]\s*\+/i.test(code),
      `${f}: SQL concatenado com +`,
    );
  }
});

test('logs passam pelo logger estruturado: nenhum console.* em src/', () => {
  const files = [
    ...filesIn('domain'),
    ...filesIn('repositories'),
    ...filesIn('services'),
    ...filesIn('http'),
    ...filesIn('jobs'),
    'db.js',
    'seed.js',
    'server.js',
    'events.js',
    'index.js',
  ];
  for (const f of files) {
    assert.ok(!/\bconsole\./.test(read(f)), `${f}: use o logger (src/logger.js), não console`);
  }
});
