import { Router } from 'express';
import { login, publicUser, register } from '../../services/auth.js';
import { requireAuth, wrap } from '../middleware.js';

export const authRouter = Router();
authRouter.post(
  '/register',
  wrap(async (req, res) => res.status(201).json(await register(req.body))),
);
authRouter.post(
  '/login',
  wrap(async (req, res) => res.json(await login(req.body))),
);
authRouter.get('/me', requireAuth(), (req, res) => res.json({ user: publicUser(req.user) }));
