import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Attributes, LotCard, LotImage, PhaseBadge } from '../src/components.jsx';
import { makeLot } from './helpers.jsx';

const card = (lot) =>
  render(
    <MemoryRouter>
      <LotCard lot={lot} />
    </MemoryRouter>,
  );

describe('LotImage', () => {
  it('mostra a imagem e cai no placeholder se falhar ou faltar', () => {
    const { rerender } = render(<LotImage src="http://x/y.jpg" alt="Obra" className="hero" />);
    const img = screen.getByAltText('Obra');
    expect(img).toHaveClass('hero');
    fireEvent.error(img);
    expect(screen.getByText(/sem imagem/)).toBeInTheDocument();
    rerender(<LotImage src={null} alt="Obra" />);
    expect(screen.getByText(/sem imagem/)).toBeInTheDocument();
  });
});

describe('PhaseBadge', () => {
  it.each([
    [{ phase: 'live' }, 'AO VIVO'],
    [{ phase: 'scheduled' }, 'Agendado'],
    [{ phase: 'ended', status: 'settled', sold: true }, 'Arrematado'],
    [{ phase: 'ended', status: 'settled', sold: false }, 'Encerrado sem lances'],
    [{ phase: 'ended', status: 'active' }, 'Encerrando'],
  ])('%j', (lot, text) => {
    render(<PhaseBadge lot={lot} />);
    expect(screen.getByText(new RegExp(text))).toBeInTheDocument();
  });
});

describe('LotCard', () => {
  it('lote ao vivo sem lances: lance inicial e contagem para o fim', () => {
    card(makeLot());
    expect(screen.getByText('Lance inicial')).toBeInTheDocument();
    expect(screen.getByText(/Termina em/)).toBeInTheDocument();
    expect(screen.getByText(/R\$\s?100,00/)).toBeInTheDocument();
  });

  it('lote ao vivo com lances: lance atual', () => {
    card(makeLot({ currentBidCents: 15000, bidCount: 2 }));
    expect(screen.getByText('Lance atual')).toBeInTheDocument();
    expect(screen.getByText(/R\$\s?150,00/)).toBeInTheDocument();
  });

  it('agendado: contagem para o início', () => {
    card(makeLot({ phase: 'scheduled' }));
    expect(screen.getByText(/Começa em/)).toBeInTheDocument();
  });

  it('encerrado vendido mostra o valor final; sem venda, o último preço', () => {
    const { unmount } = card(
      makeLot({
        phase: 'ended',
        status: 'settled',
        sold: true,
        finalCents: 20000,
        currentBidCents: 20000,
        bidCount: 3,
      }),
    );
    expect(screen.getByText(/R\$\s?200,00/)).toBeInTheDocument();
    expect(screen.getByText('3 lance(s)')).toBeInTheDocument();
    unmount();
    card(makeLot({ phase: 'ended', status: 'settled', sold: false }));
    expect(screen.getByText(/R\$\s?100,00/)).toBeInTheDocument();
  });
});

describe('Attributes', () => {
  it('lista atributos; sem atributos não renderiza nada', () => {
    const { container, rerender } = render(
      <Attributes attributes={{ Artista: 'Monet', Ano: 1870 }} />,
    );
    expect(screen.getByText('Monet')).toBeInTheDocument();
    expect(screen.getByText('1870')).toBeInTheDocument();
    rerender(<Attributes attributes={{}} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<Attributes />);
    expect(container).toBeEmptyDOMElement();
  });
});
