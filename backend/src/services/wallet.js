import { db, tx } from '../db.js';
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

/** Crédito e registro da movimentação na mesma transação: ou os dois acontecem, ou nenhum. */
export function deposit(userId, amountCents) {
  return tx(async (c) => {
    await users.credit(c, userId, amountCents);
    await transactions.insertDeposit(c, userId, amountCents);
    return walletOf(userId, c);
  });
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
