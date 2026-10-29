import bcrypt from 'bcryptjs';
import { pool, query, migrate } from '../src/db.js';
import { createLogger } from '../src/logger.js';

export async function resetDb() {
  await migrate();
  await query(
    'TRUNCATE receipts, transactions, lots, catalog_items, users RESTART IDENTITY CASCADE',
  );
}
// TRUNCATE não dispara o trigger de linha (BEFORE UPDATE OR DELETE), então serve para limpar entre testes.

export async function makeUser(role, balanceCents = 0, name = role) {
  const { rows } = await query(
    `INSERT INTO users (name, email, password_hash, role, balance_cents) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [
      name,
      `${name}-${Math.random().toString(36).slice(2)}@t.com`,
      await bcrypt.hash('x', 4),
      role,
      balanceCents,
    ],
  );
  return rows[0];
}

export const liveLot = (createLot, sellerId, over = {}) =>
  createLot(sellerId, {
    title: 'Lote de teste',
    startingBidCents: 100_00,
    minIncrementCents: 10_00,
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    ...over,
  });

/** Logger real (pino) que guarda cada evento num array, para asserções sobre o conteúdo do log. */
export function captureLogger(level = 'info') {
  const lines = [];
  const logger = createLogger({
    level,
    pretty: false,
    destination: { write: (line) => lines.push(JSON.parse(line)) },
  });
  return { logger, lines };
}

export { pool, query };
