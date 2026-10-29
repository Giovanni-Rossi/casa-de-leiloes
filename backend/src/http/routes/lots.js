import { Router } from 'express';
import { placeBid } from '../../services/bidding.js';
import { cancelLot, createLot, getVisibleLot, listShowcase } from '../../services/lots.js';
import { lotView } from '../../services/lotViews.js';
import { roomBids } from '../../services/audit.js';
import { searchCatalog } from '../../services/catalog.js';
import { listSellerLots } from '../../services/lots.js';
import { badRequest } from '../../errors.js';
import { sseHandler } from '../../events.js';
import { intParam, requireAuth, wrap } from '../middleware.js';

export const lotsRouter = Router();

// vitrine
lotsRouter.get(
  '/lots',
  wrap(async (req, res) => {
    const { q, phase, minCents, maxCents } = req.query;
    res.json({
      lots: await listShowcase(
        { q, phase, minCents: Number(minCents), maxCents: Number(maxCents) },
        req.user?.id,
      ),
    });
  }),
);

// sala ao vivo
lotsRouter.get(
  '/lots/:id',
  wrap(async (req, res) => {
    const lot = await getVisibleLot(intParam(req.params.id), req.user?.id);
    res.json({ lot: await lotView(lot, req.user?.id) });
  }),
);
lotsRouter.get(
  '/lots/:id/bids',
  wrap(async (req, res) => {
    res.json({ bids: await roomBids(intParam(req.params.id), req.user?.id) });
  }),
);
// wrap: sem ele, um erro no handler assíncrono vira unhandledRejection e derruba o processo.
lotsRouter.get('/lots/:id/stream', wrap(sseHandler((req) => `lot:${intParam(req.params.id)}`)));
lotsRouter.get('/stream', wrap(sseHandler(() => 'global')));
lotsRouter.post(
  '/lots/:id/bids',
  requireAuth('licitante'),
  wrap(async (req, res) => {
    const result = await placeBid({
      lotId: intParam(req.params.id),
      userId: req.user.id,
      amountCents: Number(req.body.amountCents),
    });
    res.status(201).json(result);
  }),
);

// leiloeiro
lotsRouter.get(
  '/catalog/search',
  requireAuth('leiloeiro'),
  wrap(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) throw badRequest('invalid_query', 'Informe um termo de busca');
    res.json(await searchCatalog(q, req.app.locals.catalogDeps));
  }),
);
lotsRouter.post(
  '/lots',
  requireAuth('leiloeiro'),
  wrap(async (req, res) => {
    const lot = await createLot(req.user.id, req.body);
    res.status(201).json({ lot: await lotView(lot, req.user.id) });
  }),
);
lotsRouter.post(
  '/lots/:id/cancel',
  requireAuth('leiloeiro'),
  wrap(async (req, res) => {
    await cancelLot({ lotId: intParam(req.params.id), sellerId: req.user.id });
    res.json({ ok: true });
  }),
);
lotsRouter.get(
  '/seller/lots',
  requireAuth('leiloeiro'),
  wrap(async (req, res) => {
    res.json(await listSellerLots(req.user.id));
  }),
);
