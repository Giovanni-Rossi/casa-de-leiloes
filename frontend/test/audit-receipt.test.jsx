import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import Audit from '../src/pages/Audit.jsx';
import Receipt from '../src/pages/Receipt.jsx';
import { apiError, mockApi, renderApp } from './helpers.jsx';

const audit = (over = {}) => ({
  lot: { id: 5, title: 'Vaso', imageUrl: null, phase: 'ended', bidCount: 2 },
  headHash: 'h'.repeat(64),
  intact: true,
  problems: [],
  bids: [
    {
      seq: 1,
      bidder: 'Licitante AAAAAA',
      amountCents: 10000,
      at: '2030-01-01T10:00:00Z',
      prevHash: '0',
      hash: 'a'.repeat(64),
    },
    {
      seq: 2,
      bidder: 'Licitante BBBBBB',
      amountCents: 11000,
      at: '2030-01-01T10:05:00Z',
      prevHash: 'a',
      hash: 'b'.repeat(64),
    },
  ],
  ...over,
});

describe('Audit', () => {
  it('histórico íntegro', async () => {
    mockApi({ 'GET /audit/5': audit() });
    renderApp(<Audit />, { route: '/auditoria/5', path: '/auditoria/:id' });
    expect(screen.getByText('Verificando…')).toBeInTheDocument();
    expect(await screen.findByText(/Histórico ÍNTEGRO/)).toBeInTheDocument();
    expect(screen.getByText('Licitante BBBBBB')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vaso' })).toHaveAttribute('href', '/lotes/5');
  });

  it('histórico adulterado destaca os problemas (com e sem lance associado)', async () => {
    mockApi({
      'GET /audit/5': audit({
        intact: false,
        problems: [
          { seq: 2, reason: 'Conteúdo do lance foi alterado' },
          { seq: null, reason: 'Hash final difere' },
        ],
      }),
    });
    renderApp(<Audit />, { route: '/auditoria/5', path: '/auditoria/:id' });
    expect(await screen.findByText(/HISTÓRICO ADULTERADO/)).toBeInTheDocument();
    expect(screen.getByText(/Lance #2: Conteúdo do lance foi alterado/)).toBeInTheDocument();
    expect(screen.getByText('Hash final difere')).toBeInTheDocument();
  });

  it('lote sem hash final e erro de carregamento', async () => {
    mockApi({ 'GET /audit/5': audit({ headHash: null, bids: [] }) });
    const { unmount } = renderApp(<Audit />, { route: '/auditoria/5', path: '/auditoria/:id' });
    expect(await screen.findByText('—')).toBeInTheDocument();
    unmount();
    mockApi({
      'GET /audit/9': () => {
        throw apiError(404, 'not_found', 'Lote não encontrado');
      },
    });
    renderApp(<Audit />, { route: '/auditoria/9', path: '/auditoria/:id' });
    expect(await screen.findByText('Lote não encontrado')).toBeInTheDocument();
  });
});

describe('Receipt', () => {
  const receipt = (over = {}) => ({
    receipt: {
      lotId: 5,
      title: 'Vaso',
      imageUrl: 'http://i',
      attributes: { Artista: 'X' },
      amountCents: 11000,
      winner: 'Licitante BBBBBB',
      seller: 'Leiloeiro CCCCCC',
      bidCount: 2,
      headHash: 'h'.repeat(64),
      issuedAt: '2030-01-01T11:00:00Z',
      auditIntact: true,
      ...over,
    },
  });

  it('comprovante com histórico íntegro', async () => {
    mockApi({ 'GET /receipts/T': receipt() });
    renderApp(<Receipt />, { route: '/comprovante/T', path: '/comprovante/:token' });
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
    expect(
      await screen.findByText('Histórico de lances íntegro.', { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText('Licitante BBBBBB')).toBeInTheDocument();
    expect(screen.getByText('Leiloeiro CCCCCC')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /auditoria completa/ })).toHaveAttribute(
      'href',
      '/auditoria/5',
    );
  });

  it('alerta quando o histórico foi adulterado', async () => {
    mockApi({ 'GET /receipts/T': receipt({ auditIntact: false }) });
    renderApp(<Receipt />, { route: '/comprovante/T', path: '/comprovante/:token' });
    expect(await screen.findByText(/foi adulterado/)).toBeInTheDocument();
  });

  it('comprovante inexistente', async () => {
    mockApi({
      'GET /receipts/X': () => {
        throw apiError(404, 'not_found', 'Comprovante não encontrado');
      },
    });
    renderApp(<Receipt />, { route: '/comprovante/X', path: '/comprovante/:token' });
    expect(await screen.findByText('Comprovante não encontrado')).toBeInTheDocument();
  });
});
