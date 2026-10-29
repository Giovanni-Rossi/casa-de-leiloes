import express from 'express';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';
import { logger } from '../logger.js';
import cors from 'cors';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { authRouter } from './routes/auth.js';
import { lotsRouter } from './routes/lots.js';
import { walletRouter } from './routes/wallet.js';
import { auditRouter } from './routes/audit.js';
import { errorHandler, notFoundHandler, optionalAuth } from './middleware.js';

/**
 * @param {object} [opts]
 * @param {string} [opts.publicDir] build do front-end a servir (SPA)
 * @param {object} [opts.catalogDeps] { fetchFn, log } injetáveis para testar a API externa
 * @param {object} [opts.log]
 */
export function createApp({ publicDir, catalogDeps, log = logger } = {}) {
  const app = express();
  app.locals.catalogDeps = catalogDeps;
  app.use(
    pinoHttp({
      logger: log,
      // ID de correlação: reaproveita o do cliente/proxy ou cria um; volta no cabeçalho da resposta.
      genReqId: (req, res) => {
        const id = String(req.headers['x-request-id'] || randomUUID()).slice(0, 64);
        res.setHeader('x-request-id', id);
        return id;
      },
      // Só a API é logada (sem arquivos estáticos nem o health check do orquestrador).
      autoLogging: { ignore: (req) => !req.url.startsWith('/api/') || req.url === '/api/health' },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        return res.statusCode >= 400 ? 'warn' : 'info';
      },
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(cors());
  app.use(express.json());
  app.use(optionalAuth);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter);
  app.use('/api', lotsRouter, walletRouter, auditRouter);
  app.use('/api', notFoundHandler);

  if (publicDir && existsSync(publicDir)) {
    app.use(express.static(publicDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
