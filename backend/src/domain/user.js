import { badRequest } from '../errors.js';

export function parseRegistration({ name, email, password, role }) {
  name = String(name ?? '').trim();
  email = String(email ?? '')
    .trim()
    .toLowerCase();
  if (!name) throw badRequest('invalid_name', 'Informe seu nome');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    throw badRequest('invalid_email', 'E-mail inválido');
  if (String(password ?? '').length < 6)
    throw badRequest('weak_password', 'A senha deve ter ao menos 6 caracteres');
  if (!['leiloeiro', 'licitante'].includes(role))
    throw badRequest('invalid_role', 'Perfil inválido');
  return { name, email, password, role };
}

export const parseAmountCents = (
  value,
  { max = Infinity, message = 'Informe um valor válido' } = {},
) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > max) throw badRequest('invalid_amount', message);
  return n;
};
