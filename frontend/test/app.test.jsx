import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '../src/App.jsx';
import { AuthProvider } from '../src/auth.jsx';
import { logIn, mockApi, stubEventSource } from './helpers.jsx';

const mount = (route = '/') =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
const base = (extra = {}) =>
  mockApi({
    'GET /lots': { lots: [] },
    'GET /wallet': { totalCents: 0, committedCents: 0, availableCents: 0, transactions: [] },
    'GET /my/bids': { lots: [] },
    'GET /seller/lots': { lots: [], totalReceivedCents: 0 },
    ...extra,
  });
const as = (role) => {
  logIn();
  return base({ 'GET /auth/me': { user: { id: 1, name: 'Fulano', role } } });
};

describe('App — navegação', () => {
  it('visitante vê a vitrine e o link Entrar', async () => {
    stubEventSource();
    base();
    mount();
    expect(await screen.findByText(/Nenhum lote ao vivo/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Entrar' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Carteira' })).not.toBeInTheDocument();
  });

  it('licitante vê carteira e arremates, e pode sair', async () => {
    stubEventSource();
    as('licitante');
    mount();
    expect(await screen.findByRole('link', { name: 'Carteira' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Meus arremates' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Painel do leiloeiro/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(await screen.findByRole('link', { name: 'Entrar' })).toBeInTheDocument();
  });

  it('leiloeiro vê o painel', async () => {
    stubEventSource();
    as('leiloeiro');
    mount();
    expect(await screen.findByRole('link', { name: 'Painel do leiloeiro' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Carteira' })).not.toBeInTheDocument();
  });

  it('rota inexistente', () => {
    base();
    mount('/qualquer-coisa');
    expect(screen.getByText('Página não encontrada.')).toBeInTheDocument();
  });
});

describe('App — rotas protegidas', () => {
  it('anônimo é redirecionado para o login', async () => {
    base();
    mount('/carteira');
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
  });

  it('mostra "Carregando" enquanto confirma o usuário', async () => {
    logIn();
    base({ 'GET /auth/me': () => new Promise(() => {}) });
    mount('/carteira');
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
  });

  it('perfil errado volta para a vitrine', async () => {
    stubEventSource();
    as('leiloeiro');
    mount('/carteira');
    expect(await screen.findByText(/Nenhum lote ao vivo/)).toBeInTheDocument();
  });

  it('perfil correto acessa a página', async () => {
    as('licitante');
    mount('/carteira');
    expect(await screen.findByText('Minha carteira')).toBeInTheDocument();
  });

  it('rotas públicas de auditoria e comprovante', async () => {
    base({
      'GET /audit/1': {
        lot: { id: 1, title: 'X', phase: 'ended', bidCount: 0 },
        headHash: null,
        intact: true,
        problems: [],
        bids: [],
      },
    });
    mount('/auditoria/1');
    expect(await screen.findByText('Auditoria do lote')).toBeInTheDocument();
  });
});

describe('App — tema', () => {
  it('usa o tema salvo, alterna e persiste', async () => {
    stubEventSource();
    base();
    localStorage.setItem('leilao.theme', 'dark');
    mount();
    expect(document.documentElement.dataset.theme).toBe('dark');
    await userEvent.click(screen.getByRole('button', { name: 'Alternar tema' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('leilao.theme')).toBe('light');
    await userEvent.click(screen.getByRole('button', { name: 'Alternar tema' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('sem tema salvo segue a preferência do sistema', () => {
    stubEventSource();
    base();
    window.matchMedia = vi.fn((q) => ({ matches: true, media: q }));
    mount();
    expect(document.documentElement.dataset.theme).toBe('dark');
    window.matchMedia = vi.fn((q) => ({ matches: false, media: q }));
    localStorage.clear(); // a 1ª montagem persistiu o tema
    document.documentElement.removeAttribute('data-theme');
    mount();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('funciona mesmo se o localStorage estiver bloqueado', () => {
    stubEventSource();
    base();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    mount();
    expect(document.documentElement.dataset.theme).toMatch(/light|dark/);
  });
});
