import { HttpError, forbidden, notFound } from '../errors.js';
import { userFromAuthHeader } from '../services/auth.js';

export const wrap = (fn) => (req, res, next) => (async () => fn(req, res, next))().catch(next);

export function intParam(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw notFound();
  return n;
}

/** Anexa req.user se houver token válido; nunca bloqueia. */
export const optionalAuth = wrap(async (req, _res, next) => {
  req.user = await userFromAuthHeader(req.headers.authorization);
  next();
});

export const requireAuth = (role) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'unauthenticated', 'Faça login para continuar'));
  if (role && req.user.role !== role) {
    return next(
      forbidden(
        role === 'licitante'
          ? 'Apenas licitantes podem fazer isso'
          : 'Apenas leiloeiros podem fazer isso',
      ),
    );
  }
  next();
};

export const notFoundHandler = (_req, _res, next) => next(notFound('Rota não encontrada'));

export const errorHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'invalid_json', message: 'Corpo da requisição não é um JSON válido' },
    });
  }
  req.log.error({ err, userId: req.user?.id }, 'erro inesperado');
  res.status(500).json({ error: { code: 'internal', message: 'Erro interno do servidor' } });
};
