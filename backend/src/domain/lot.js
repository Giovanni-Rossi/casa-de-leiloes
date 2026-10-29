import { pseudonym } from './chain.js';
import { badRequest } from '../errors.js';

/** scheduled | live | ended | cancelled — derivado do status + relógio. */
export function phaseOf(lot, now = Date.now()) {
  if (lot.status === 'cancelled') return 'cancelled';
  if (lot.status === 'settled') return 'ended';
  if (now < new Date(lot.starts_at).getTime()) return 'scheduled';
  if (now < new Date(lot.ends_at).getTime()) return 'live';
  return 'ended';
}

export const minNextBid = (lot) =>
  lot.bid_count === 0 ? lot.starting_bid_cents : lot.current_bid_cents + lot.min_increment_cents;

/** leading | outbid | none — situação do espectador em relação ao lote. */
export function myStatusOf(lot, viewerId, hasBid) {
  if (!viewerId) return 'none';
  if (lot.leader_id === viewerId) return 'leading';
  return hasBid ? 'outbid' : 'none';
}

export function toLotView(lot, myStatus = 'none', now = Date.now()) {
  return {
    id: lot.id,
    title: lot.title,
    description: lot.description,
    imageUrl: lot.image_url,
    attributes: lot.attributes,
    sourceUrl: lot.source_url,
    startingBidCents: lot.starting_bid_cents,
    minIncrementCents: lot.min_increment_cents,
    startsAt: lot.starts_at,
    endsAt: lot.ends_at,
    originalEndsAt: lot.original_ends_at,
    phase: phaseOf(lot, now),
    status: lot.status,
    currentBidCents: lot.current_bid_cents,
    nextMinBidCents: minNextBid(lot),
    bidCount: lot.bid_count,
    leader: lot.leader_id ? pseudonym(lot.id, lot.leader_id) : null,
    myStatus,
    finalCents: lot.final_cents,
    sold: lot.status === 'settled' ? lot.winner_id !== null : null,
    serverNow: new Date(now).toISOString(),
  };
}

/** Filtros da vitrine (texto, fase e faixa de preço). Função pura. */
export function filterLots(
  lots,
  { q = '', phase = '', minCents = 0, maxCents = 0 } = {},
  now = Date.now(),
) {
  const term = String(q).trim().toLowerCase();
  const price = (l) => l.current_bid_cents ?? l.starting_bid_cents;
  let list = lots;
  if (term) {
    list = list.filter((l) =>
      `${l.title} ${l.description ?? ''} ${JSON.stringify(l.attributes)}`
        .toLowerCase()
        .includes(term),
    );
  }
  if (['live', 'scheduled', 'ended'].includes(phase))
    list = list.filter((l) => phaseOf(l, now) === phase);
  if (minCents > 0) list = list.filter((l) => price(l) >= minCents);
  if (maxCents > 0) list = list.filter((l) => price(l) <= maxCents);
  return phase === 'ended' ? [...list].reverse() : list;
}

/** Aceita só http(s): impede `javascript:`/`data:` em links e imagens renderizados no front. */
function parseUrl(value, field) {
  if (!value) return null;
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw badRequest('invalid_url', `URL inválida em ${field}`);
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw badRequest('invalid_url', `URL inválida em ${field}`);
  return url.href;
}

/** Valida e normaliza os dados de criação de um lote. */
export function parseLotInput(input, now = Date.now()) {
  const title = String(input.title ?? '').trim();
  const startingBidCents = Number(input.startingBidCents);
  const minIncrementCents = Number(input.minIncrementCents);
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (!title) throw badRequest('invalid_title', 'Informe o título do lote');
  if (!Number.isInteger(startingBidCents) || startingBidCents <= 0)
    throw badRequest('invalid_starting_bid', 'Lance inicial inválido');
  if (!Number.isInteger(minIncrementCents) || minIncrementCents <= 0)
    throw badRequest('invalid_increment', 'Incremento mínimo inválido');
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()))
    throw badRequest('invalid_dates', 'Datas inválidas');
  if (endsAt <= startsAt) throw badRequest('invalid_dates', 'O fim deve ser depois do início');
  if (endsAt.getTime() <= now)
    throw badRequest('invalid_dates', 'O fim do lote deve estar no futuro');
  return {
    externalId: input.externalId ? String(input.externalId) : null,
    title,
    description: input.description ? String(input.description) : null,
    imageUrl: parseUrl(input.imageUrl, 'imageUrl'),
    attributes: input.attributes && typeof input.attributes === 'object' ? input.attributes : {},
    sourceUrl: parseUrl(input.sourceUrl, 'sourceUrl'),
    startingBidCents,
    minIncrementCents,
    startsAt,
    endsAt,
  };
}

/** Novo fim do lote após um lance (anti-sniping): lance nos últimos 2 min => fim = agora + 2 min. */
export function extendedEnd(endsAtMs, now, windowMs) {
  return endsAtMs - now <= windowMs ? now + windowMs : null;
}
