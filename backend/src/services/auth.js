import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { parseRegistration } from '../domain/user.js';
import { HttpError } from '../errors.js';
import * as users from '../repositories/users.js';

export const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const sign = (u) => jwt.sign({ sub: u.id, role: u.role }, config.jwtSecret, { expiresIn: '7d' });

export async function register(body) {
  const { name, email, password, role } = parseRegistration(body);
  try {
    const user = await users.insert(db, {
      name,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      role,
      balanceCents: 0,
    });
    logger.info({ userId: user.id, role }, 'usuário cadastrado');
    return { token: sign(user), user: publicUser(user) };
  } catch (err) {
    if (err.code === '23505')
      throw new HttpError(409, 'email_taken', 'Este e-mail já está cadastrado');
    throw err;
  }
}

export async function login({ email, password }) {
  const user = await users.findByEmail(
    db,
    String(email ?? '')
      .trim()
      .toLowerCase(),
  );
  if (!user || !(await bcrypt.compare(String(password ?? ''), user.password_hash))) {
    logger.warn({ userId: user?.id ?? null }, 'tentativa de login recusada');
    throw new HttpError(401, 'invalid_credentials', 'E-mail ou senha incorretos');
  }
  return { token: sign(user), user: publicUser(user) };
}

/** Resolve o usuário de um header "Bearer <jwt>" (ou null se ausente/inválido). */
export async function userFromAuthHeader(header = '') {
  if (!header.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret);
    return await users.findById(db, payload.sub);
  } catch {
    return null;
  }
}
