import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../src/auth.jsx';
import { apiError, logIn, mockApi } from './helpers.jsx';

let ctx;
function Probe() {
  ctx = useAuth();
  return <div>{ctx.loading ? 'carregando' : ctx.user ? `olá ${ctx.user.name}` : 'anônimo'}</div>;
}
const mount = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
const user = { id: 1, name: 'Ana', role: 'licitante' };

describe('AuthProvider', () => {
  it('sem token: anônimo e sem chamar a API', () => {
    const f = mockApi({});
    mount();
    expect(screen.getByText('anônimo')).toBeInTheDocument();
    expect(f).not.toHaveBeenCalled();
  });

  it('com token válido: carrega o usuário', async () => {
    logIn();
    mockApi({ 'GET /auth/me': { user } });
    mount();
    expect(screen.getByText('carregando')).toBeInTheDocument();
    expect(await screen.findByText('olá Ana')).toBeInTheDocument();
  });

  it('token inválido: descarta o token', async () => {
    logIn('velho');
    mockApi({
      'GET /auth/me': () => {
        throw apiError(401, 'unauthenticated', 'x');
      },
    });
    mount();
    expect(await screen.findByText('anônimo')).toBeInTheDocument();
    expect(localStorage.getItem('leilao.token')).toBeNull();
  });

  it('login, registro e logout', async () => {
    mockApi({
      'POST /auth/login': { token: 'T1', user },
      'POST /auth/register': { token: 'T2', user: { ...user, name: 'Bia' } },
    });
    mount();
    await act(async () => {
      expect(await ctx.login({ email: 'a', password: 'b' })).toEqual(user);
    });
    expect(screen.getByText('olá Ana')).toBeInTheDocument();
    expect(localStorage.getItem('leilao.token')).toBe('T1');
    await act(async () => {
      await ctx.register({});
    });
    await waitFor(() => expect(screen.getByText('olá Bia')).toBeInTheDocument());
    act(() => ctx.logout());
    expect(screen.getByText('anônimo')).toBeInTheDocument();
    expect(localStorage.getItem('leilao.token')).toBeNull();
  });
});
