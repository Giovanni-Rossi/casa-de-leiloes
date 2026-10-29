import { Router } from 'express';
import { deposit, walletWithHistory } from '../../services/wallet.js';
import { listMyBids } from '../../services/lots.js';
import { parseAmountCents } from '../../domain/user.js';
import { requireAuth, wrap } from '../middleware.js';

export const walletRouter = Router();
walletRouter.get(
  '/wallet',
  requireAuth(),
  wrap(async (req, res) => res.json(await walletWithHistory(req.user.id))),
);
walletRouter.post(
  '/wallet/deposit',
  requireAuth(),
  wrap(async (req, res) => {
    const cents = parseAmountCents(req.body.amountCents, {
      max: 100_000_000_00,
      message: 'Informe um valor de depósito válido',
    });
    res.status(201).json(await deposit(req.user.id, cents));
  }),
);
walletRouter.get(
  '/my/bids',
  requireAuth('licitante'),
  wrap(async (req, res) => {
    res.json({ lots: await listMyBids(req.user.id) });
  }),
);
