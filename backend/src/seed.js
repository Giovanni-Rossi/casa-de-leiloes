import bcrypt from 'bcryptjs';
import { db } from './db.js';
import { logger } from './logger.js';
import * as users from './repositories/users.js';
import * as catalogItems from './repositories/catalogItems.js';
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

/** Dados de teste: 1 leiloeiro, 2 licitantes e um lote ao vivo com lances. Idempotente. */
export async function seed() {
  if (await users.findByEmail(db, 'leiloeiro@teste.com')) return;

  const seller = await createUser('Leiloeiro Demo', 'leiloeiro@teste.com', 'leiloeiro', 0);
  const ana = await createUser('Ana Licitante', 'ana@teste.com', 'licitante', 500_000_00);
  const bruno = await createUser('Bruno Licitante', 'bruno@teste.com', 'licitante', 500_000_00);
  for (const item of ITEMS) await catalogItems.upsert(db, item);

  const hour = 3_600_000;
  const base = { ...ITEMS[0], startingBidCents: 1_000_00, minIncrementCents: 50_00 };
  const live = await createLot(seller.id, {
    ...base,
    startsAt: new Date(Date.now() - 1000).toISOString(),
    endsAt: new Date(Date.now() + 6 * hour).toISOString(),
  });
  await placeBid({ lotId: live.id, userId: ana.id, amountCents: 1_000_00 });
  await placeBid({ lotId: live.id, userId: bruno.id, amountCents: 1_100_00 });

  await createLot(seller.id, {
    ...base,
    title: 'The Red Kerchief (agendado)',
    startsAt: new Date(Date.now() + 2 * hour).toISOString(),
    endsAt: new Date(Date.now() + 26 * hour).toISOString(),
  });
  logger.info('seed concluído: contas de teste criadas (senha documentada no README)');
}
