export function insert(db, bid) {
  return db.query(
    `INSERT INTO bids (lot_id, seq, bidder_id, amount_cents, created_ms, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [bid.lotId, bid.seq, bid.bidderId, bid.amountCents, bid.createdMs, bid.prevHash, bid.hash],
  );
}

export async function listByLot(db, lotId) {
  const { rows } = await db.query('SELECT * FROM bids WHERE lot_id = $1 ORDER BY seq', [lotId]);
  return rows;
}

export async function hasBidFrom(db, lotId, bidderId) {
  const { rowCount } = await db.query(
    'SELECT 1 FROM bids WHERE lot_id = $1 AND bidder_id = $2 LIMIT 1',
    [lotId, bidderId],
  );
  return rowCount > 0;
}

export async function seqsFrom(db, lotId, bidderId) {
  const { rows } = await db.query('SELECT seq FROM bids WHERE lot_id = $1 AND bidder_id = $2', [
    lotId,
    bidderId,
  ]);
  return rows.map((row) => row.seq);
}
