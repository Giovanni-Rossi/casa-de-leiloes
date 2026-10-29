import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../src/auth.jsx';

/**
 * Simula o fetch da aplicação. `routes`: { 'GET /lots': (body, url) => data | throw {status, code, message} }.
 * Chaves casam pelo método + caminho (sem /api e sem query). Devolve o mock para inspeção.
 */
export function mockApi(routes) {
  const fn = vi.fn(async (url, opts = {}) => {
    const u = String(url).replace(/^\/api/, '');
    const path = u.split('?')[0];
    const key = `${opts.method ?? 'GET'} ${path}`;
    const handler = routes[key];
    if (!handler) throw new Error(`rota não mockada: ${key}`);
    try {
      const data =
        typeof handler === 'function'
          ? await handler(opts.body ? JSON.parse(opts.body) : undefined, u)
          : handler;
      return { ok: true, status: 200, json: async () => data };
    } catch (e) {
      if (e && e.status)
        return {
          ok: false,
          status: e.status,
          json: async () => ({ error: { code: e.code, message: e.message } }),
        };
      throw e;
    }
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export class FakeEventSource {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.listeners = {};
    this.closed = false;
    FakeEventSource.instances.push(this);
  }
  addEventListener(name, fn) {
    (this.listeners[name] ??= []).push(fn);
  }
  close() {
    this.closed = true;
  }
  emit(name) {
    (this.listeners[name] ?? []).forEach((f) => f({}));
  }
}

export function stubEventSource() {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  return FakeEventSource;
}

export function renderApp(ui, { route = '/', path = '*' } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <Routes>
          <Route path={path} element={ui} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

export const apiError = (status, code, message) => ({ status, code, message });
export const logIn = (token = 't') => localStorage.setItem('leilao.token', token);

let n = 0;
export const makeLot = (over = {}) => ({
  id: ++n,
  title: 'Vaso Ming',
  description: 'Bela peça',
  imageUrl: 'http://img/x.jpg',
  attributes: { Artista: 'Anônimo' },
  sourceUrl: 'http://src',
  startingBidCents: 10000,
  minIncrementCents: 1000,
  startsAt: new Date(Date.now() - 60000).toISOString(),
  endsAt: new Date(Date.now() + 3600000).toISOString(),
  originalEndsAt: new Date(Date.now() + 3600000).toISOString(),
  phase: 'live',
  status: 'active',
  currentBidCents: null,
  nextMinBidCents: 10000,
  bidCount: 0,
  leader: null,
  myStatus: 'none',
  finalCents: null,
  sold: null,
  serverNow: new Date().toISOString(),
  ...over,
});
