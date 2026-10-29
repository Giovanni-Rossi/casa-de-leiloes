import { db } from '../db.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { normalizeItem } from '../domain/catalog.js';
import * as catalogItems from '../repositories/catalogItems.js';

const CACHE_LIMIT = 20;
const TIMEOUT_MS = 6000;
const RETRYABLE_STATUS = new Set([502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Falha passageira, que vale uma nova tentativa: erro de rede (o `fetch` do Node lança
 * `TypeError: fetch failed`, ex.: ECONNRESET) ou gateway instável (502/503/504).
 * Timeout não entra: tentar de novo dobraria a espera do usuário.
 */
const isTransient = (err) =>
  RETRYABLE_STATUS.has(err.status) ||
  (err.name === 'TypeError' && err.message.startsWith('fetch failed'));

async function fetchFromApi(url, fetchFn) {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    throw Object.assign(new Error(`API respondeu ${res.status}`), { status: res.status });
  }
  const body = await res.json();
  return (body.data ?? []).map(normalizeItem).filter((item) => item.imageUrl);
}

/** Uma única nova tentativa, e só para falhas passageiras. */
async function fetchWithRetry(url, fetchFn, log, retryDelayMs) {
  try {
    return await fetchFromApi(url, fetchFn);
  } catch (err) {
    if (!isTransient(err)) throw err;
    log.info({ err }, 'falha passageira na API externa; nova tentativa');
    await sleep(retryDelayMs);
    return fetchFromApi(url, fetchFn);
  }
}

/** Busca na API externa; se ela falhar, cai no cache local (degradação graciosa). */
export async function searchCatalog(q, { fetchFn = fetch, log = logger, retryDelayMs = 300 } = {}) {
  const url = new URL(config.catalogUrl);
  url.search = new URLSearchParams({ q, limit: '20', has_image: '1' }).toString();
  try {
    const items = await fetchWithRetry(url, fetchFn, log, retryDelayMs);
    for (const item of items) await catalogItems.upsert(db, item);
    return { items, source: 'api' };
  } catch (err) {
    log.warn({ err }, 'API externa indisponível, usando cache local');
    return { items: await catalogItems.search(db, q, CACHE_LIMIT), source: 'cache' };
  }
}
