import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Wallet from '../src/pages/Wallet.jsx';
import MyBids from '../src/pages/MyBids.jsx';
import { apiError, makeLot, mockApi, renderApp } from './helpers.jsx';

const wallet = (over = {}) => ({
  totalCents: 100000,
  committedCents: 30000,
  availableCents: 70000,
  transactions: [],
  ...over,
});

describe('Wallet', () => {
  it('mostra saldos, histórico e faz depósito', async () => {
    let w = wallet({
      transactions: [
        { id: 1, type: 'deposit', amountCents: 5000, at: '2030-01-01T10:00:00Z', lotTitle: null },
        { id: 2, type: 'debit', amountCents: 2000, at: '2030-01-01T11:00:00Z', lotTitle: 'Vaso' },
        { id: 3, type: 'credit', amountCents: 1000, at: '2030-01-01T12:00:00Z', lotTitle: 'Prato' },
      ],
    });
    mockApi({
      'GET /wallet': () => w,
      'POST /wallet/deposit': (b) => {
        w = {
          ...w,
          totalCents: w.totalCents + b.amountCents,
          availableCents: w.availableCents + b.amountCents,
        };
        return w;
      },
    });
    renderApp(<Wallet />);
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
    expect(await screen.findByText('Saldo total')).toBeInTheDocument();
    expect(screen.getByText('Depósito')).toBeInTheDocument();
    expect(screen.getByText(/−.*20,00/)).toBeInTheDocument();
    expect(screen.getByText('Venda (crédito)')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Valor do depósito'), '500,00');
    await userEvent.click(screen.getByRole('button', { name: 'Depositar' }));
    expect(await screen.findByText(/Depósito simulado de .*500,00 realizado/)).toBeInTheDocument();
    expect(screen.getByLabelText('Valor do depósito')).toHaveValue('');
  });

  it('sem movimentações, valor inválido e erro do servidor', async () => {
    mockApi({
      'GET /wallet': wallet(),
      'POST /wallet/deposit': () => {
        throw apiError(400, 'invalid_amount', 'Valor recusado');
      },
    });
    renderApp(<Wallet />);
    expect(await screen.findByText('Nada por aqui ainda.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Depositar' }));
    expect(screen.getByText('Informe um valor válido.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Valor do depósito'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Depositar' }));
    expect(await screen.findByText('Valor recusado')).toBeInTheDocument();
  });

  it('ignora falha ao carregar e atualiza por polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let fail = true;
    const f = mockApi({
      'GET /wallet': () => {
        if (fail) throw apiError(500, 'x', 'x');
        return wallet();
      },
    });
    renderApp(<Wallet />);
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
    fail = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(await screen.findByText('Saldo total')).toBeInTheDocument();
  });
});

describe('MyBids', () => {
  const lots = () => [
    makeLot({
      title: 'Ganho',
      won: true,
      phase: 'ended',
      status: 'settled',
      finalCents: 20000,
      receiptToken: 'TOK1',
    }),
    makeLot({
      title: 'Liderando',
      myStatus: 'leading',
      currentBidCents: 15000,
      receiptToken: null,
    }),
    makeLot({
      title: 'Lote superado',
      myStatus: 'outbid',
      currentBidCents: 18000,
      receiptToken: null,
    }),
    makeLot({
      title: 'Perdido',
      phase: 'ended',
      status: 'settled',
      won: false,
      currentBidCents: 9000,
      receiptToken: null,
    }),
    makeLot({
      title: 'Fechando',
      phase: 'ended',
      status: 'active',
      won: false,
      currentBidCents: 9000,
      receiptToken: null,
    }),
  ];

  it('separa vencidos dos demais e mostra a situação de cada um', async () => {
    mockApi({ 'GET /my/bids': { lots: lots() } });
    renderApp(<MyBids />);
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
    expect(await screen.findByText('Você venceu')).toBeInTheDocument();
    for (const t of ['Ganhando', 'Superado', 'Não arrematado', 'Encerrando…'])
      expect(screen.getByText(t)).toBeInTheDocument();
    expect(screen.getByText(/Arrematado por .*200,00/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Comprovante' })).toHaveAttribute(
      'href',
      '/comprovante/TOK1',
    );
  });

  it('copia o link do comprovante (e cai para prompt se o clipboard falhar)', async () => {
    mockApi({ 'GET /my/bids': { lots: lots().slice(0, 1) } });
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderApp(<MyBids />);
    await userEvent.click(await screen.findByRole('button', { name: 'Copiar link' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/comprovante/TOK1'));
    expect(await screen.findByText('Link copiado')).toBeInTheDocument();

    writeText.mockRejectedValue(new Error('negado'));
    const prompt = vi.spyOn(window, 'prompt').mockImplementation(() => null);
    await userEvent.click(screen.getByRole('button', { name: /Link copiado/ }));
    await waitFor(() => expect(prompt).toHaveBeenCalled());
  });

  it('estados vazios e falha de carregamento', async () => {
    mockApi({ 'GET /my/bids': { lots: [] } });
    renderApp(<MyBids />);
    expect(await screen.findByText('Você ainda não venceu nenhum lote.')).toBeInTheDocument();
    expect(screen.getByText('Nenhum outro lote.')).toBeInTheDocument();
  });

  it('mantém "Carregando" se a API falhar e atualiza por polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let fail = true;
    mockApi({
      'GET /my/bids': () => {
        if (fail) throw apiError(500, 'x', 'x');
        return { lots: [] };
      },
    });
    renderApp(<MyBids />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
    fail = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(await screen.findByText('Meus arremates')).toBeInTheDocument();
  });
});
