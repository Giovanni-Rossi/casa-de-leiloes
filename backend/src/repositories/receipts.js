export function insert(db, receipt) {
  return db.query(
    `INSERT INTO receipts (lot_id, token, winner_id, seller_id, amount_cents, bid_count, head_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      receipt.lotId,
      receipt.token,
      receipt.winnerId,
      receipt.sellerId,
      receipt.amountCents,
      receipt.bidCount,
      receipt.headHash,
    ],
  );
}

export async function findByToken(db, token) {
  const { rows } = await db.query('SELECT * FROM receipts WHERE token = $1', [token]);
  return rows[0] ?? null;
}

export async function listByWinner(db, userId) {
  const { rows } = await db.query('SELECT lot_id, token FROM receipts WHERE winner_id = $1', [
    userId,
  ]);
  return rows;
}
