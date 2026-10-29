export function insertDeposit(db, userId, amountCents) {
  return db.query(
    `INSERT INTO transactions (user_id, type, amount_cents) VALUES ($1, 'deposit', $2)`,
    [userId, amountCents],
  );
}

/** Débito do vencedor + crédito do leiloeiro, na mesma instrução. */
export function insertSale(db, { lotId, winnerId, sellerId, amountCents }) {
  return db.query(
    `INSERT INTO transactions (user_id, lot_id, type, amount_cents)
     VALUES ($1, $3, 'debit', $2), ($4, $3, 'credit', $2)`,
    [winnerId, amountCents, lotId, sellerId],
  );
}

export async function listByUser(db, userId, limit) {
  const { rows } = await db.query(
    `SELECT t.id, t.type, t.amount_cents, t.created_at, l.title AS lot_title
       FROM transactions t
       LEFT JOIN lots l ON l.id = t.lot_id
      WHERE t.user_id = $1
      ORDER BY t.id DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows;
}
