import { Router } from 'express';
import { publicAudit, receiptByToken } from '../../services/audit.js';
import { intParam, wrap } from '../middleware.js';

// Rotas PÚBLICAS: auditoria e comprovante não exigem login.
export const auditRouter = Router();
auditRouter.get(
  '/audit/:id',
  wrap(async (req, res) => res.json(await publicAudit(intParam(req.params.id)))),
);
auditRouter.get(
  '/receipts/:token',
  wrap(async (req, res) => res.json({ receipt: await receiptByToken(req.params.token) })),
);
