import bcrypt from 'bcryptjs';
import { db } from './db.js';
import { logger } from './logger.js';
import * as users from './repositories/users.js';
import * as catalogItems from './repositories/catalogItems.js';
import * as lots from './repositories/lots.js';
import { phaseOf } from './domain/lot.js';
import { createLot } from './services/lots.js';
import { placeBid } from './services/bidding.js';

const PASSWORD = 'senha123';

const ITEMS = [
  {
    externalId: '135382',
    title: 'The Red Kerchief',
    imageUrl: 'https://openaccess-cdn.clevelandart.org/1958.39/1958.39_web.jpg',
    description: 'Retrato de Camille, primeira esposa de Monet, num dia de neve em Argenteuil.',
    attributes: {
      Artista: 'Claude Monet (French, 1840–1926)',
      Data: 'c. 1868–73',
      Tipo: 'Painting',
      Técnica: 'oil on fabric',
    },
    sourceUrl: 'https://clevelandart.org/art/1958.39',
  },
];

const createUser = async (name, email, role, balanceCents) =>
  users.insert(db, {
    name,
    email,
    passwordHash: await bcrypt.hash(PASSWORD, 10),
    role,
    balanceCents,
  });

const HOUR = 3_600_000;
const LIVE_DAYS = 30;
const BASE = { ...ITEMS[0], startingBidCents: 1_000_00, minIncrementCents: 50_00 };

/**
 * Garante um lote ao vivo com lances do leiloeiro demo, que dure ao menos mais um dia. Roda a
 * cada subida: num deploy com banco persistente o lote semeado antes pode já ter encerrado.
 */
async function ensureLiveLot(seller) {
  const lasting = (l) => new Date(l.ends_at).getTime() - Date.now() > 24 * HOUR;
  const own = await lots.listBySeller(db, seller.id);
  if (own.some((l) => phaseOf(l) === 'live' && l.bid_count > 0 && lasting(l))) return;
  const live = await createLot(seller.id, {
    ...BASE,
    startsAt: new Date(Date.now() - 1000).toISOString(),
    endsAt: new Date(Date.now() + LIVE_DAYS * 24 * HOUR).toISOString(),
  });
  try {
    const ana = await users.findByEmail(db, 'ana@teste.com');
    const bruno = await users.findByEmail(db, 'bruno@teste.com');
    await placeBid({ lotId: live.id, userId: ana.id, amountCents: 1_000_00 });
    await placeBid({ lotId: live.id, userId: bruno.id, amountCents: 1_100_00 });
  } catch (err) {
    // ex.: contas demo sem saldo — o lote fica ao vivo sem lances, mas a subida não falha
    logger.warn({ err, lotId: live.id }, 'seed: não foi possível dar os lances de demonstração');
  }
  logger.info({ lotId: live.id }, 'seed: lote ao vivo de demonstração criado');
}

/** Dados de teste: 1 leiloeiro, 2 licitantes, um lote ao vivo com lances e um agendado. Idempotente. */
export async function seed() {
  let seller = await users.findByEmail(db, 'leiloeiro@teste.com');
  const firstRun = !seller;
  if (firstRun) {
    seller = await createUser('Leiloeiro Demo', 'leiloeiro@teste.com', 'leiloeiro', 0);
    await createUser('Ana Licitante', 'ana@teste.com', 'licitante', 500_000_00);
    await createUser('Bruno Licitante', 'bruno@teste.com', 'licitante', 500_000_00);
    for (const item of ITEMS) await catalogItems.upsert(db, item);
  }

  await ensureLiveLot(seller);

  if (firstRun) {
    await createLot(seller.id, {
      ...BASE,
      title: 'The Red Kerchief (agendado)',
      startsAt: new Date(Date.now() + 2 * HOUR).toISOString(),
      endsAt: new Date(Date.now() + 26 * HOUR).toISOString(),
    });
    logger.info('seed concluído: contas de teste criadas (senha documentada no README)');
  }
}
