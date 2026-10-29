import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Seller from '../src/pages/Seller.jsx';
import { apiError, makeLot, mockApi, renderApp } from './helpers.jsx';

const item = (over = {}) => ({
  externalId: '1',
  title: 'Vaso Ming',
  imageUrl: 'http://i',
  description: 'd',
  attributes: { Artista: 'Anônimo' },
  sourceUrl: 's',
  ...over,
});
const mine = (lots = [], total = 0) => ({ lots, totalReceivedCents: total });

async function search(term = 'vase') {
  await userEvent.type(screen.getByLabelText('Buscar item'), term);
  await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
}

describe('Seller — busca e criação', () => {
  it('busca na API, escolhe item e publica o lote', async () => {
    const f = mockApi({
      'GET /seller/lots': mine([], 0),
      'GET /catalog/search': {
        source: 'api',
        items: [
          item(),
          item({ externalId: '2', title: 'Sem artista', attributes: { Tipo: 'Vase' } }),
          item({ externalId: '3', title: 'Sem nada', attributes: {} }),
        ],
      },
      'POST /lots': { lot: makeLot() },
    });
    renderApp(<Seller />);
    expect(await screen.findByText('Você ainda não criou lotes.')).toBeInTheDocument();
    expect(screen.getByText('Escolha um item ao lado.')).toBeInTheDocument();
    await search();
    expect(await screen.findByText('Vaso Ming')).toBeInTheDocument();
    expect(screen.queryByText(/API externa está indisponível/)).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Usar' })[0]);
    await userEvent.type(screen.getByLabelText('Lance inicial (R$)'), '100');
    await userEvent.type(screen.getByLabelText('Incremento mínimo (R$)'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Publicar lote' }));
    expect(await screen.findByText('Lote criado!')).toBeInTheDocument();
    const post = f.mock.calls.find(([, o]) => o?.method === 'POST');
    expect(JSON.parse(post[1].body)).toMatchObject({
      title: 'Vaso Ming',
      startingBidCents: 10000,
      minIncrementCents: 1000,
      externalId: '1',
    });
    expect(screen.getByText('Escolha um item ao lado.')).toBeInTheDocument();
  });

  it('avisa quando a API caiu (cache), mostra "nada encontrado" e ignora busca vazia', async () => {
    mockApi({ 'GET /seller/lots': mine(), 'GET /catalog/search': { source: 'cache', items: [] } });
    renderApp(<Seller />);
    await screen.findByText('Meus lotes');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' })); // vazio: não chama a API
    expect(fetch.mock.calls.some(([u]) => u.includes('/catalog/'))).toBe(false);
    await search('zzz');
    expect(await screen.findByText(/API externa está indisponível/)).toBeInTheDocument();
    expect(screen.getByText('Nada encontrado.')).toBeInTheDocument();
  });

  it('erro na busca e erros de validação/servidor ao criar', async () => {
    let failSearch = true;
    mockApi({
      'GET /seller/lots': mine(),
      'GET /catalog/search': () => {
        if (failSearch) throw apiError(400, 'x', 'Busca falhou');
        return { source: 'api', items: [item()] };
      },
      'POST /lots': () => {
        throw apiError(400, 'invalid_dates', 'Datas inválidas');
      },
    });
    renderApp(<Seller />);
    await screen.findByText('Meus lotes');
    await search();
    expect(await screen.findByText('Busca falhou')).toBeInTheDocument();
    failSearch = false;
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Usar' }));
    fireEvent.change(screen.getByLabelText('Lance inicial (R$)'), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText('Incremento mínimo (R$)'), { target: { value: '10' } });
    await userEvent.click(screen.getByRole('button', { name: 'Publicar lote' }));
    expect(screen.getByText('Informe lance inicial e incremento válidos.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Lance inicial (R$)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Início'), { target: { value: '2030-01-01T10:00' } });
    fireEvent.change(screen.getByLabelText('Fim'), { target: { value: '2030-01-01T12:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Publicar lote' }));
    expect(await screen.findByText('Datas inválidas')).toBeInTheDocument();
  });
});

describe('Seller — meus lotes', () => {
  const lots = () => [
    makeLot({ id: 101, title: 'Ao vivo sem lances' }),
    makeLot({ id: 102, title: 'Ao vivo com lances', bidCount: 2, currentBidCents: 15000 }),
    makeLot({
      id: 103,
      title: 'Vendido',
      phase: 'ended',
      status: 'settled',
      sold: true,
      finalCents: 20000,
      currentBidCents: 20000,
      bidCount: 3,
    }),
    makeLot({ id: 104, title: 'Sem venda', phase: 'ended', status: 'settled', sold: false }),
    makeLot({ id: 105, title: 'Cancelado', status: 'cancelled', phase: 'cancelled' }),
    makeLot({ id: 106, title: 'Encerrando', phase: 'ended', status: 'active' }),
  ];

  it('mostra resultado de cada lote e o total recebido', async () => {
    mockApi({ 'GET /seller/lots': mine(lots(), 20000) });
    renderApp(<Seller />);
    expect(await screen.findByText(/Arrematado por .*200,00/)).toBeInTheDocument();
    expect(screen.getByText('Sem lances — sem vencedor')).toBeInTheDocument();
    expect(screen.getByText('Cancelado', { selector: '.badge' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Cancelar' })).toHaveLength(2); // só ativos e não encerrados
    expect(screen.getByText('Total recebido').nextSibling).toHaveTextContent(/200,00/);
  });

  it('cancela com confirmação (aviso diferente se houver lances) e trata recusa/erro', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    let fail = false;
    const f = mockApi({
      'GET /seller/lots': mine(lots().slice(0, 2)),
      'POST /lots/101/cancel': () => {
        if (fail) throw apiError(422, 'cannot_cancel', 'Já encerrado');
        return { ok: true };
      },
      'POST /lots/102/cancel': { ok: true },
    });
    renderApp(<Seller />);
    const buttons = await screen.findAllByRole('button', { name: 'Cancelar' });

    confirm.mockReturnValueOnce(false);
    await userEvent.click(buttons[0]);
    expect(confirm).toHaveBeenLastCalledWith('Cancelar este lote?');
    expect(f.mock.calls.some(([u]) => u.includes('/cancel'))).toBe(false);

    confirm.mockReturnValue(true);
    await userEvent.click(buttons[1]);
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('2 lance(s)'));
    await waitFor(() => expect(f.mock.calls.some(([u]) => u.includes('/102/cancel'))).toBe(true));

    fail = true;
    await userEvent.click(buttons[0]);
    expect(await screen.findByText('Já encerrado')).toBeInTheDocument();
  });

  it('atualiza a lista por polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let list = [];
    mockApi({ 'GET /seller/lots': () => mine(list) });
    renderApp(<Seller />);
    await screen.findByText('Você ainda não criou lotes.');
    list = [makeLot({ title: 'Novo lote' })];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(await screen.findByText('Novo lote')).toBeInTheDocument();
  });

  it('ignora falha ao carregar a lista', async () => {
    mockApi({
      'GET /seller/lots': () => {
        throw apiError(500, 'x', 'x');
      },
    });
    renderApp(<Seller />);
    expect(await screen.findByText('Você ainda não criou lotes.')).toBeInTheDocument();
  });
});
