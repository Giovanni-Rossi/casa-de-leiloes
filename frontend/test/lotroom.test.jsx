import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LotRoom from '../src/pages/LotRoom.jsx';
import { apiError, logIn, makeLot, mockApi, renderApp, stubEventSource } from './helpers.jsx';

const bids = (...rows) => ({
  bids: rows.map(([seq, bidder, amountCents, mine = false]) => ({
    seq,
    bidder,
    amountCents,
    mine,
    at: '2030-01-01T10:00:00Z',
  })),
});
const wallet = { totalCents: 100000, committedCents: 0, availableCents: 100000, transactions: [] };
const room = (opts = {}) =>
  renderApp(<LotRoom />, { route: `/lotes/${opts.id ?? 1}`, path: '/lotes/:id' });

function setup({ lot = makeLot({ id: 1 }), bidList = bids(), role = null, extra = {} } = {}) {
  const ES = stubEventSource();
  let current = lot;
  const routes = {
    'GET /lots/1': () => current,
    'GET /lots/1/bids': () => bidList,
    ...extra,
  };
  routes['GET /lots/1'] = () => ({ lot: current });
  if (role) {
    logIn();
    routes['GET /auth/me'] = { user: { id: 1, name: 'Ana', role } };
    if (role === 'licitante') routes['GET /wallet'] ??= wallet;
  }
  const f = mockApi(routes);
  return {
    f,
    ES,
    set: (l) => {
      current = l;
    },
  };
}

describe('LotRoom — visitante', () => {
  it('mostra o lote, o convite para entrar e o histórico vazio', async () => {
    setup({ lot: makeLot({ id: 1, description: null, sourceUrl: null, attributes: {} }) });
    room();
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Vaso Ming' })).toBeInTheDocument();
    expect(screen.getByText('Nenhum lance ainda.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Entre' })).toBeInTheDocument();
    expect(screen.queryByText(/fonte original/)).not.toBeInTheDocument();
    expect(screen.getByText('Lance inicial')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Auditar integridade/ })).toHaveAttribute(
      'href',
      '/auditoria/1',
    );
  });

  it('lote com descrição, fonte e líder; sem espaço para lance quando encerrado e sem convite', async () => {
    setup({
      lot: makeLot({
        id: 1,
        phase: 'ended',
        status: 'settled',
        sold: true,
        finalCents: 12000,
        currentBidCents: 12000,
        bidCount: 2,
        leader: 'Licitante AAAAAA',
      }),
      bidList: bids([2, 'Licitante AAAAAA', 12000], [1, 'Licitante BBBBBB', 11000]),
    });
    room();
    expect(await screen.findByText('Bela peça')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /fonte original/ })).toHaveAttribute(
      'href',
      'http://src',
    );
    expect(screen.getByText(/Arrematado por .*120,00/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Entre' })).not.toBeInTheDocument();
    expect(screen.getAllByText(/Licitante AAAAAA/).length).toBeGreaterThan(0);
  });

  it('encerrado sem lances', async () => {
    setup({ lot: makeLot({ id: 1, phase: 'ended', status: 'settled', sold: false }) });
    room();
    expect(await screen.findByText(/sem vencedor/)).toBeInTheDocument();
  });

  it('agendado: contagem para o início', async () => {
    setup({ lot: makeLot({ id: 1, phase: 'scheduled' }) });
    room();
    expect(await screen.findByText('Começa em')).toBeInTheDocument();
  });

  it('404 mostra aviso; outros erros mantêm "Carregando"', async () => {
    stubEventSource();
    mockApi({
      'GET /lots/1': () => {
        throw apiError(404, 'not_found', 'x');
      },
      'GET /lots/1/bids': bids(),
    });
    const { unmount } = room();
    expect(await screen.findByText(/não encontrado ou cancelado/)).toBeInTheDocument();
    unmount();
    mockApi({
      'GET /lots/1': () => {
        throw apiError(500, 'x', 'x');
      },
      'GET /lots/1/bids': bids(),
    });
    room();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
  });

  it('atualiza por evento SSE e por polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { ES, set, f } = setup();
    room();
    await screen.findByRole('heading', { name: 'Vaso Ming' });
    set(makeLot({ id: 1, title: 'Título novo' }));
    act(() => ES.instances[0].emit('bid'));
    expect(await screen.findByRole('heading', { name: 'Título novo' })).toBeInTheDocument();
    set(makeLot({ id: 1, title: 'Via polling' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(await screen.findByRole('heading', { name: 'Via polling' })).toBeInTheDocument();
    expect(f).toHaveBeenCalled();
  });

  it('quando a contagem zera, rebusca o estado do lote', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const past = new Date(Date.now() - 1000).toISOString();
    const { f } = setup({
      lot: makeLot({ id: 1, endsAt: past, serverNow: new Date().toISOString() }),
    });
    room();
    await screen.findByRole('heading', { name: 'Vaso Ming' });
    const before = f.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(f.mock.calls.length).toBeGreaterThan(before);
  });

  it('contagem urgente (< 2 min) ganha destaque; com mais tempo, não', async () => {
    setup({ lot: makeLot({ id: 1, endsAt: new Date(Date.now() + 60000).toISOString() }) });
    const { unmount } = room();
    await screen.findByRole('heading', { name: 'Vaso Ming' });
    expect(document.querySelector('.countdown')).toHaveClass('urgent');
    unmount();
    setup();
    room();
    await screen.findByRole('heading', { name: 'Vaso Ming' });
    expect(document.querySelector('.countdown')).not.toHaveClass('urgent');
  });
});

describe('LotRoom — licitante', () => {
  const live = (over = {}) =>
    makeLot({
      id: 1,
      currentBidCents: 11000,
      nextMinBidCents: 12000,
      bidCount: 2,
      leader: 'Licitante BBBBBB',
      ...over,
    });

  it('dá lance com sucesso e preenche o lance mínimo com o botão', async () => {
    const { f } = setup({
      role: 'licitante',
      lot: live(),
      bidList: bids([2, 'Licitante BBBBBB', 11000], [1, 'Licitante AAAAAA', 10000, true]),
      extra: {
        'POST /lots/1/bids': () => ({ seq: 3, extended: false }),
      },
    });
    room();
    expect(await screen.findByText(/Saldo disponível/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lance mínimo' }));
    expect(screen.getByLabelText(/Seu lance/)).toHaveValue('120');
    await userEvent.click(screen.getByRole('button', { name: 'Dar lance' }));
    expect(await screen.findByText('Lance aceito!')).toBeInTheDocument();
    expect(JSON.parse(f.mock.calls.find(([, o]) => o?.method === 'POST')[1].body)).toEqual({
      amountCents: 12000,
    });
    expect(screen.getByLabelText(/Seu lance/)).toHaveValue('');
  });

  it('informa a prorrogação (anti-sniping)', async () => {
    setup({ role: 'licitante', extra: { 'POST /lots/1/bids': { seq: 1, extended: true } } });
    room();
    await userEvent.type(await screen.findByLabelText(/Seu lance/), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Dar lance' }));
    expect(await screen.findByText(/prorrogado em \+2 minutos/)).toBeInTheDocument();
  });

  it.each([
    ['below_minimum', 'Lance abaixo do mínimo.'],
    ['insufficient_funds', 'Saldo insuficiente — deposite na sua carteira.'],
    ['already_leading', 'Você já está ganhando este lote.'],
    ['lot_not_started', 'Este lote ainda não foi iniciado.'],
    ['lot_ended', 'Lote encerrado.'],
    ['lot_cancelled', 'Este lote foi cancelado.'],
    ['outro_codigo', 'Mensagem do servidor'],
  ])('lance recusado (%s) mostra o motivo', async (codeName, text) => {
    setup({
      role: 'licitante',
      extra: {
        'POST /lots/1/bids': () => {
          throw apiError(422, codeName, 'Mensagem do servidor');
        },
      },
    });
    room();
    await userEvent.type(await screen.findByLabelText(/Seu lance/), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Dar lance' }));
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('valor inválido não chama a API', async () => {
    const { f } = setup({ role: 'licitante' });
    room();
    await userEvent.type(await screen.findByLabelText(/Seu lance/), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Dar lance' }));
    expect(screen.getByText('Informe um valor válido.')).toBeInTheDocument();
    expect(f.mock.calls.some(([, o]) => o?.method === 'POST')).toBe(false);
  });

  it('"você está ganhando" + posição', async () => {
    setup({
      role: 'licitante',
      lot: live({ myStatus: 'leading', leader: 'Licitante AAAAAA' }),
      bidList: bids([2, 'Licitante AAAAAA', 11000, true], [1, 'Licitante BBBBBB', 10000]),
    });
    room();
    expect(await screen.findByText('Você está ganhando!')).toBeInTheDocument();
    expect(screen.getByText('1º')).toBeInTheDocument();
    expect(screen.getByText(/\(você\)/)).toBeInTheDocument();
  });

  it('"você foi superado" + posição', async () => {
    setup({
      role: 'licitante',
      lot: live({ myStatus: 'outbid' }),
      bidList: bids(
        [3, 'Licitante CCCCCC', 12000],
        [2, 'Licitante BBBBBB', 11000],
        [1, 'Licitante AAAAAA', 10000, true],
      ),
    });
    room();
    expect(await screen.findByText('Você foi superado.')).toBeInTheDocument();
    expect(screen.getByText('3º')).toBeInTheDocument();
  });

  it('quem venceu vê a mensagem de vitória após o encerramento', async () => {
    setup({
      role: 'licitante',
      lot: live({
        phase: 'ended',
        status: 'settled',
        sold: true,
        finalCents: 11000,
        myStatus: 'leading',
      }),
    });
    room();
    expect(await screen.findByText(/Você venceu este lote/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Seu lance/)).not.toBeInTheDocument();
  });

  it('não permite lance em lote agendado', async () => {
    setup({ role: 'licitante', lot: makeLot({ id: 1, phase: 'scheduled' }) });
    room();
    await screen.findByText('Começa em');
    expect(screen.queryByLabelText(/Seu lance/)).not.toBeInTheDocument();
  });

  it('falha ao carregar a carteira não impede de ver o lote nem de dar lance', async () => {
    setup({
      role: 'licitante',
      extra: {
        'GET /wallet': () => {
          throw apiError(500, 'x', 'x');
        },
      },
    });
    room();
    expect(await screen.findByRole('heading', { name: 'Vaso Ming' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Seu lance/)).toBeInTheDocument();
    expect(screen.queryByText(/Saldo disponível/)).not.toBeInTheDocument();
  });
});

describe('LotRoom — leiloeiro', () => {
  it('não vê formulário de lance', async () => {
    setup({ role: 'leiloeiro' });
    room();
    expect(await screen.findByText('Leiloeiros não podem dar lances.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dar lance' })).not.toBeInTheDocument();
  });
});
