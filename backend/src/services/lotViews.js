import { db } from '../db.js';
import { myStatusOf, toLotView } from '../domain/lot.js';
import * as bids from '../repositories/bids.js';

export async function lotView(lot, viewerId = null) {
  const hasBid =
    viewerId && lot.leader_id !== viewerId ? await bids.hasBidFrom(db, lot.id, viewerId) : false;
  return toLotView(lot, myStatusOf(lot, viewerId, hasBid));
}
