import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extendedEnd,
  filterLots,
  minNextBid,
  myStatusOf,
  parseLotInput,
  phaseOf,
  toLotView,
} from '../../src/domain/lot.js';
import { parseAmountCents, parseRegistration } from '../../src/domain/user.js';
import { normalizeItem } from '../../src/domain/catalog.js';
import { HttpError, badRequest, forbidden, notFound, rejection } from '../../src/errors.js';

const NOW = Date.parse('2030-01-01T12:00:00Z');
const at = (min) => new Date(NOW + min * 60000).toISOString();
const lot = (over = {}) => ({
  id: 1,
  status: 'active',
  title: 'Vaso Ming',
  description: 'Porcelana azul',
  attributes: { Artista: 'Anônimo' },
  starting_bid_cents: 100,
  min_increment_cents: 10,
  current_bid_cents: null,
  bid_count: 0,
  starts_at: at(-10),
  ends_at: at(10),
  leader_id: null,
  winner_id: null,
  ...over,
});

test('phaseOf cobre todas as fases', () => {
  assert.equal(phaseOf(lot({ status: 'cancelled' }), NOW), 'cancelled');
  assert.equal(phaseOf(lot({ status: 'settled' }), NOW), 'ended');
  assert.equal(phaseOf(lot({ starts_at: at(5) }), NOW), 'scheduled');
  assert.equal(phaseOf(lot(), NOW), 'live');
  assert.equal(phaseOf(lot({ ends_at: at(-1) }), NOW), 'ended');
  const realNow = Date.now(); // sem 2º argumento usa o relógio real
  assert.equal(
    phaseOf(lot({ starts_at: new Date(realNow - 1000), ends_at: new Date(realNow + 60000) })),
    'live',
  );
});

test('minNextBid: inicial sem lances, atual + incremento depois', () => {
  assert.equal(minNextBid(lot()), 100);
  assert.equal(minNextBid(lot({ bid_count: 2, current_bid_cents: 150 })), 160);
});

test('myStatusOf', () => {
  assert.equal(myStatusOf(lot(), null, false), 'none');
  assert.equal(myStatusOf(lot({ leader_id: 3 }), 3, true), 'leading');
  assert.equal(myStatusOf(lot({ leader_id: 4 }), 3, true), 'outbid');
  assert.equal(myStatusOf(lot({ leader_id: 4 }), 3, false), 'none');
});

test('toLotView: campos públicos, sem IDs internos de pessoas', () => {
  const v = toLotView(lot(), 'none', NOW);
  assert.equal(v.phase, 'live');
  assert.equal(v.leader, null);
  assert.equal(v.sold, null);
  assert.equal(v.serverNow, new Date(NOW).toISOString());
  assert.ok(!('seller_id' in v) && !('sellerId' in v) && !('leader_id' in v));

  const led = toLotView(
    lot({ leader_id: 2, bid_count: 1, current_bid_cents: 100 }),
    'leading',
    NOW,
  );
  assert.match(led.leader, /^Licitante /);
  assert.equal(led.myStatus, 'leading');
  assert.equal(led.nextMinBidCents, 110);

  assert.equal(toLotView(lot({ status: 'settled', winner_id: 2 }), 'none', NOW).sold, true);
  assert.equal(toLotView(lot({ status: 'settled', winner_id: null }), 'none', NOW).sold, false);
  assert.equal(toLotView(lot()).myStatus, 'none'); // defaults
});

test('filterLots: texto, fase, preço e ordem dos encerrados', () => {
  const a = lot({ id: 1, title: 'Monet', description: null, attributes: { Técnica: 'óleo' } });
  const b = lot({ id: 2, title: 'Vaso', ends_at: at(-1), current_bid_cents: 500, bid_count: 1 });
  const c = lot({
    id: 3,
    title: 'Futuro',
    starts_at: at(60),
    ends_at: at(120),
    starting_bid_cents: 900,
  });
  const all = [a, b, c];
  assert.deepEqual(
    filterLots(all, undefined, NOW).map((l) => l.id),
    [1, 2, 3],
  );
  assert.deepEqual(
    filterLots(all, { q: 'monet' }, NOW).map((l) => l.id),
    [1],
  );
  assert.deepEqual(
    filterLots(all, { q: 'ÓLEO' }, NOW).map((l) => l.id),
    [1],
  );
  assert.deepEqual(
    filterLots(all, { q: 'porcelana' }, NOW).map((l) => l.id),
    [2, 3],
  ); // descrição; a (null) não casa
  assert.deepEqual(
    filterLots(all, { phase: 'live' }, NOW).map((l) => l.id),
    [1],
  );
  assert.deepEqual(
    filterLots(all, { phase: 'scheduled' }, NOW).map((l) => l.id),
    [3],
  );
  assert.deepEqual(
    filterLots(all, { phase: 'ended' }, NOW).map((l) => l.id),
    [2],
  );
  assert.deepEqual(
    filterLots(all, { phase: 'inexistente' }, NOW).map((l) => l.id),
    [1, 2, 3],
  );
  assert.deepEqual(
    filterLots(all, { minCents: 400 }, NOW).map((l) => l.id),
    [2, 3],
  );
  assert.deepEqual(
    filterLots(all, { maxCents: 400 }, NOW).map((l) => l.id),
    [1],
  );
  assert.deepEqual(
    filterLots([b, { ...b, id: 9 }], { phase: 'ended' }, NOW).map((l) => l.id),
    [9, 2],
  );
  assert.ok(Array.isArray(filterLots(all))); // sem filtros nem relógio
});

const input = (over = {}) => ({
  title: '  Vaso ',
  startingBidCents: 100,
  minIncrementCents: 10,
  startsAt: at(0),
  endsAt: at(60),
  ...over,
});

test('parseLotInput: normaliza entrada válida', () => {
  const out = parseLotInput(
    input({
      externalId: 5,
      description: 'd',
      imageUrl: 'http://img/a.jpg',
      sourceUrl: 'https://src/x',
      attributes: { a: 1 },
    }),
    NOW,
  );
  assert.deepEqual([out.imageUrl, out.sourceUrl], ['http://img/a.jpg', 'https://src/x']);
  assert.equal(out.title, 'Vaso');
  assert.equal(out.externalId, '5');
  assert.deepEqual(out.attributes, { a: 1 });
  assert.ok(out.startsAt instanceof Date);

  const min = parseLotInput(input({ attributes: 'texto' }), NOW);
  assert.deepEqual(
    [min.externalId, min.description, min.imageUrl, min.sourceUrl, min.attributes],
    [null, null, null, null, {}],
  );
  assert.ok(
    parseLotInput(
      input({ startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 60000) }),
    ),
  );
});

test('parseLotInput: rejeita entradas inválidas', () => {
  const bad = (over, code) =>
    assert.throws(
      () => parseLotInput(input(over), NOW),
      (e) => e instanceof HttpError && e.status === 400 && e.code === code,
    );
  bad({ title: '   ' }, 'invalid_title');
  bad({ title: undefined }, 'invalid_title');
  bad({ startingBidCents: 0 }, 'invalid_starting_bid');
  bad({ startingBidCents: 1.5 }, 'invalid_starting_bid');
  bad({ minIncrementCents: -1 }, 'invalid_increment');
  bad({ startsAt: 'xx' }, 'invalid_dates');
  bad({ endsAt: 'xx' }, 'invalid_dates');
  bad({ endsAt: at(-5) }, 'invalid_dates');
  bad({ sourceUrl: 'javascript:alert(1)' }, 'invalid_url');
  bad({ imageUrl: 'data:text/html,<script>1</script>' }, 'invalid_url');
  bad({ sourceUrl: 'não é url' }, 'invalid_url');
  bad({ startsAt: at(-120), endsAt: at(-60) }, 'invalid_dates');
});

test('extendedEnd (anti-sniping)', () => {
  const W = 120000;
  assert.equal(extendedEnd(NOW + 30000, NOW, W), NOW + W);
  assert.equal(extendedEnd(NOW + W, NOW, W), NOW + W); // exatamente 2 min restantes
  assert.equal(extendedEnd(NOW + W + 1, NOW, W), null);
});

test('parseRegistration', () => {
  assert.deepEqual(
    parseRegistration({
      name: ' Ana ',
      email: ' ANA@X.COM ',
      password: '123456',
      role: 'licitante',
    }),
    { name: 'Ana', email: 'ana@x.com', password: '123456', role: 'licitante' },
  );
  const bad = (over, code) =>
    assert.throws(
      () =>
        parseRegistration({
          name: 'A',
          email: 'a@x.com',
          password: '123456',
          role: 'licitante',
          ...over,
        }),
      (e) => e.code === code,
    );
  bad({ name: '' }, 'invalid_name');
  bad({ email: 'sem-arroba' }, 'invalid_email');
  bad({ password: '123' }, 'weak_password');
  bad({ role: 'admin' }, 'invalid_role');
  assert.throws(
    () => parseRegistration({}),
    (e) => e.code === 'invalid_name',
  );
  assert.throws(
    () => parseRegistration({ name: 'A' }),
    (e) => e.code === 'invalid_email',
  );
  assert.throws(
    () => parseRegistration({ name: 'A', email: 'a@x.com' }),
    (e) => e.code === 'weak_password',
  );
});

test('parseAmountCents', () => {
  assert.equal(parseAmountCents('150'), 150);
  for (const v of [0, -1, 1.5, 'abc', undefined, NaN]) {
    assert.throws(
      () => parseAmountCents(v),
      (e) => e.code === 'invalid_amount' && e.message === 'Informe um valor válido',
    );
  }
  assert.throws(
    () => parseAmountCents(11, { max: 10, message: 'grande' }),
    (e) => e.message === 'grande',
  );
});

test('normalizeItem: item completo, mínimo e fallback de descrição', () => {
  const full = normalizeItem({
    id: 9,
    title: 'Red',
    creation_date: '1870',
    type: 'Painting',
    technique: 'óleo',
    department: 'Moderna',
    culture: ['France', '19th'],
    measurements: '10 cm',
    creators: [{ description: 'Monet' }],
    images: { web: { url: 'http://img' } },
    description: '<p>Bela <b>obra</b></p>',
    url: 'http://src',
  });
  assert.deepEqual(full, {
    externalId: '9',
    title: 'Red',
    imageUrl: 'http://img',
    description: 'Bela obra',
    sourceUrl: 'http://src',
    attributes: {
      Artista: 'Monet',
      Data: '1870',
      Tipo: 'Painting',
      Técnica: 'óleo',
      Departamento: 'Moderna',
      Cultura: 'France, 19th',
      Medidas: '10 cm',
    },
  });
  const min = normalizeItem({ id: 1, title: 'X', tombstone: '<i>Tombstone</i>' });
  assert.deepEqual(min, {
    externalId: '1',
    title: 'X',
    imageUrl: null,
    description: 'Tombstone',
    sourceUrl: null,
    attributes: {},
  });
  assert.equal(normalizeItem({ id: 2, title: 'Y' }).description, null);
});

test('fábricas de erro HTTP', () => {
  assert.deepEqual(
    [
      badRequest('c', 'm').status,
      forbidden().status,
      notFound().status,
      rejection('c', 'm').status,
    ],
    [400, 403, 404, 422],
  );
  assert.equal(forbidden().message, 'Acesso negado');
  assert.equal(notFound().message, 'Não encontrado');
  assert.equal(notFound('x').message, 'x');
});
