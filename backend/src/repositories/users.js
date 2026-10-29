export async function findById(db, id) {
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function findByEmail(db, email) {
  const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] ?? null;
}

export async function insert(db, { name, email, passwordHash, role, balanceCents }) {
  const { rows } = await db.query(
    `INSERT INTO users (name, email, password_hash, role, balance_cents)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [name, email, passwordHash, role, balanceCents],
  );
  return rows[0];
}

export function lockById(db, id) {
  return db.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [id]);
}

/** Trava vários usuários em ordem de id (evita deadlock entre transações concorrentes). */
export function lockByIds(db, ids) {
  return db.query('SELECT id FROM users WHERE id = ANY($1) ORDER BY id FOR UPDATE', [ids]);
}

export function credit(db, id, amountCents) {
  return db.query('UPDATE users SET balance_cents = balance_cents + $2 WHERE id = $1', [
    id,
    amountCents,
  ]);
}

/** Debita só se houver saldo; devolve se o débito ocorreu. */
export async function debit(db, id, amountCents) {
  const { rowCount } = await db.query(
    `UPDATE users
        SET balance_cents = balance_cents - $2
      WHERE id = $1 AND balance_cents >= $2`,
    [id, amountCents],
  );
  return rowCount === 1;
}

/** Saldo total + comprometido (soma dos lances líderes em lotes ainda não liquidados). */
export async function walletRow(db, id) {
  const { rows } = await db.query(
    `SELECT u.balance_cents,
            COALESCE((SELECT SUM(current_bid_cents)::bigint
                        FROM lots
                       WHERE leader_id = u.id AND status = 'active'), 0) AS committed_cents
       FROM users u
      WHERE u.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}
