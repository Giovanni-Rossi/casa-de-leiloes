import { db } from '../db.js';
import { notFound } from '../errors.js';
import * as users from '../repositories/users.js';
import * as transactions from '../repositories/transactions.js';

const HISTORY_LIMIT = 30;

/** Saldo: total, comprometido (lances líderes em lotes não liquidados) e disponível. */
export async function walletOf(userId, executor = db) {
  const row = await users.walletRow(executor, userId);
  if (!row) throw notFound('Usuário não encontrado');
  const { balance_cents: total, committed_cents: committed } = row;
  return { totalCents: total, committedCents: committed, availableCents: total - committed };
}

export async function deposit(userId, amountCents) {
  await users.credit(db, userId, amountCents);
  await transactions.insertDeposit(db, userId, amountCents);
  return walletOf(userId);
}

export async function walletWithHistory(userId) {
  const rows = await transactions.listByUser(db, userId, HISTORY_LIMIT);
  return {
    ...(await walletOf(userId)),
    transactions: rows.map((t) => ({
      id: t.id,
      type: t.type,
      amountCents: t.amount_cents,
      at: t.created_at,
      lotTitle: t.lot_title,
    })),
  };
}
