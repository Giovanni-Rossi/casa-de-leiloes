import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { logger } from './logger.js';

// BIGINT (centavos) volta como number: os valores cabem com folga em 2^53.
pg.types.setTypeParser(20, (v) => Number(v));

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

// O erro de uma conexão em uso chega pela query pendente; sem listener, o evento 'error' derrubaria o processo.
pool.on('connect', (client) => client.on('error', () => {}));
// Conexão ociosa cortada pelo servidor não pode derrubar o processo.
pool.on('error', (err) => logger.error({ err }, 'erro em conexão ociosa do pool'));

export const query = (text, params) => pool.query(text, params);

/** Executor padrão dos repositórios fora de transação; dentro de `tx` eles recebem o client da transação. */
export const db = { query };

export async function tx(fn) {
  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN');
    result = await fn(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return result;
}

export async function migrate() {
  const sql = readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8');
  await pool.query(sql);
}
