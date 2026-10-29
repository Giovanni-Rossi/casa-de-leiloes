import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Showcase from '../src/pages/Showcase.jsx';
import AuthPage from '../src/pages/AuthPage.jsx';
import { apiError, makeLot, mockApi, renderApp, stubEventSource } from './helpers.jsx';

describe('Showcase', () => {
  it('lista lotes, troca de aba, filtra e reage a eventos em tempo real', async () => {
    const ES = stubEventSource();
    const f = mockApi({
      'GET /lots': (_b, url) => ({
        lots: url.includes('phase=scheduled') ? [] : [makeLot({ title: 'Vaso A' })],
      }),
    });
    renderApp(<Showcase />);
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
    expect(await screen.findByText('Vaso A')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Agendados' }));
    expect(await screen.findByText(/Nenhum lote agendados/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Encerrados' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ao vivo' }));
    await screen.findByText('Vaso A');

    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'monet' } });
    fireEvent.change(screen.getByLabelText('Preço mínimo'), { target: { value: '10,00' } });
    fireEvent.change(screen.getByLabelText('Preço máximo'), { target: { value: '500' } });
    await waitFor(() => {
      const last = f.mock.calls.at(-1)[0];
      expect(last).toContain('q=monet');
      expect(last).toContain('minCents=1000');
      expect(last).toContain('maxCents=50000');
    });

    const before = f.mock.calls.length;
    act(() => ES.instances[0].emit('lot'));
    await waitFor(() => expect(f.mock.calls.length).toBeGreaterThan(before));
  });

  it('mostra erro da API e refaz a busca periodicamente', async () => {
    stubEventSource();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let fail = true;
    const f = mockApi({
      'GET /lots': () => {
        if (fail) throw apiError(500, 'internal', 'Falhou');
        return { lots: [] };
      },
    });
    renderApp(<Showcase />);
    expect(await screen.findByText('Falhou')).toBeInTheDocument();
    fail = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    await waitFor(() => expect(screen.queryByText('Falhou')).not.toBeInTheDocument());
    expect(f.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('AuthPage', () => {
  it('login bem-sucedido de licitante volta para a vitrine', async () => {
    mockApi({
      'POST /auth/login': { token: 't', user: { id: 1, name: 'Ana', role: 'licitante' } },
    });
    renderApp(<AuthPage />);
    expect(screen.getByText(/senha123/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@x.com');
    await userEvent.type(screen.getByLabelText('Senha'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(localStorage.getItem('leilao.token')).toBe('t'));
  });

  it('login de leiloeiro e mensagem de erro', async () => {
    let first = true;
    mockApi({
      'POST /auth/login': () => {
        if (first) {
          first = false;
          throw apiError(401, 'invalid_credentials', 'E-mail ou senha incorretos');
        }
        return { token: 't2', user: { id: 2, name: 'Leo', role: 'leiloeiro' } };
      },
    });
    renderApp(<AuthPage />);
    await userEvent.type(screen.getByLabelText('E-mail'), 'l@x.com');
    await userEvent.type(screen.getByLabelText('Senha'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('E-mail ou senha incorretos')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(localStorage.getItem('leilao.token')).toBe('t2'));
  });

  it('alterna para cadastro, escolhe perfil e cadastra; volta para login', async () => {
    const f = mockApi({
      'POST /auth/register': { token: 'r', user: { id: 3, name: 'Caio', role: 'leiloeiro' } },
    });
    renderApp(<AuthPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(screen.queryByText(/senha123/)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Nome'), 'Caio');
    await userEvent.selectOptions(screen.getByLabelText('Perfil'), 'leiloeiro');
    await userEvent.type(screen.getByLabelText('E-mail'), 'c@x.com');
    await userEvent.type(screen.getByLabelText('Senha'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));
    await waitFor(() =>
      expect(JSON.parse(f.mock.calls[0][1].body)).toMatchObject({
        name: 'Caio',
        role: 'leiloeiro',
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Já tenho conta' }));
    expect(screen.getByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
  });
});
