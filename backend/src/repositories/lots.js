export async function findById(db, id) {
  const { rows } = await db.query('SELECT * FROM lots WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function lockById(db, id) {
  const { rows } = await db.query('SELECT * FROM lots WHERE id = $1 FOR UPDATE', [id]);
  return rows[0] ?? null;
}

export async function insert(db, lot) {
  const { rows } = await db.query(
    `INSERT INTO lots (seller_id, external_id, title, description, image_url, attributes,
                       source_url, starting_bid_cents, min_increment_cents, starts_at,
                       ends_at, original_ends_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
     RETURNING *`,
    [
      lot.sellerId,
      lot.externalId,
      lot.title,
      lot.description,
      lot.imageUrl,
      JSON.stringify(lot.attributes),
      lot.sourceUrl,
      lot.startingBidCents,
      lot.minIncrementCents,
      lot.startsAt,
      lot.endsAt,
    ],
  );
  return rows[0];
}

export async function listNotCancelled(db) {
  const { rows } = await db.query(
    `SELECT * FROM lots WHERE status <> 'cancelled' ORDER BY ends_at`,
  );
  return rows;
}

export async function listBySeller(db, sellerId) {
  const { rows } = await db.query(
    'SELECT * FROM lots WHERE seller_id = $1 ORDER BY created_at DESC',
    [sellerId],
  );
  return rows;
}

export async function listWithBidFrom(db, userId) {
  const { rows } = await db.query(
    `SELECT l.*
       FROM lots l
      WHERE l.status <> 'cancelled'
        AND EXISTS (SELECT 1 FROM bids b WHERE b.lot_id = l.id AND b.bidder_id = $1)
      ORDER BY l.ends_at DESC`,
    [userId],
  );
  return rows;
}

export async function totalReceivedBy(db, sellerId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(final_cents), 0)::bigint AS total
       FROM lots
      WHERE seller_id = $1 AND status = 'settled' AND winner_id IS NOT NULL`,
    [sellerId],
  );
  return rows[0].total;
}

export async function listDueIds(db) {
  const { rows } = await db.query(
    `SELECT id FROM lots WHERE status = 'active' AND ends_at <= now()`,
  );
  return rows.map((row) => row.id);
}

/** Atualiza a "âncora" do lote (lance atual, líder, hash final) na mesma transação do lance. */
export function recordBid(db, { lotId, amountCents, leaderId, seq, hash, anchorMac, endsAt }) {
  return db.query(
    `UPDATE lots
        SET current_bid_cents = $2, leader_id = $3, bid_count = $4, head_hash = $5,
            anchor_mac = $6, ends_at = $7
      WHERE id = $1`,
    [lotId, amountCents, leaderId, seq, hash, anchorMac, endsAt],
  );
}

export async function setAnchorMac(db, id, anchorMac) {
  const { rows } = await db.query('UPDATE lots SET anchor_mac = $2 WHERE id = $1 RETURNING *', [
    id,
    anchorMac,
  ]);
  return rows[0];
}

export async function listWithoutAnchorMac(db) {
  const { rows } = await db.query('SELECT * FROM lots WHERE anchor_mac IS NULL ORDER BY id');
  return rows;
}

export function markSettledWithoutWinner(db, id) {
  return db.query(`UPDATE lots SET status = 'settled', settled_at = now() WHERE id = $1`, [id]);
}

export function markSold(db, id, finalCents) {
  return db.query(
    `UPDATE lots
        SET status = 'settled', winner_id = leader_id, final_cents = $2, settled_at = now()
      WHERE id = $1`,
    [id, finalCents],
  );
}

export function markCancelled(db, id) {
  return db.query(`UPDATE lots SET status = 'cancelled', cancelled_at = now() WHERE id = $1`, [id]);
}
