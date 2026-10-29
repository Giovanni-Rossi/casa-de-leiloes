import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../api.js';
import { LotCard } from '../components.jsx';
import { useStream, usePoll, parseMoney } from '../util.js';

const TABS = [
  ['live', 'Ao vivo'],
  ['scheduled', 'Agendados'],
  ['ended', 'Encerrados'],
];

export default function Showcase() {
  const [phase, setPhase] = useState('live');
  const [q, setQ] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [lots, setLots] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const params = new URLSearchParams({ phase });
    if (q.trim()) params.set('q', q.trim());
    const minC = parseMoney(min);
    const maxC = parseMoney(max);
    if (minC) params.set('minCents', minC);
    if (maxC) params.set('maxCents', maxC);
    api(`/lots?${params}`)
      .then((d) => {
        setLots(d.lots);
        setError('');
      })
      .catch((e) => setError(e.message));
  }, [phase, q, min, max]);

  useEffect(() => {
    const id = setTimeout(load, 200);
    return () => clearTimeout(id);
  }, [load]);
  useStream('/api/stream', ['lot'], load);
  usePoll(load, 15000); // rede de segurança caso o stream caia; também move lotes agendados -> ao vivo

  return (
    <>
      <h1>Leilões</h1>
      <p className="lead">
        Peças do acervo aberto do Cleveland Museum of Art, com lances ao vivo e histórico auditável.
      </p>
      <div className="tabs">
        {TABS.map(([key, label]) => (
          <button key={key} className={phase === key ? 'on' : ''} onClick={() => setPhase(key)}>
            {label}
          </button>
        ))}
      </div>
      <div className="filters">
        <div className="search">
          <Search size={17} strokeWidth={1.75} aria-hidden="true" />
          <input
            placeholder="Buscar por título, artista, técnica…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Buscar"
          />
        </div>
        <input
          placeholder="Preço mín. (R$)"
          value={min}
          onChange={(e) => setMin(e.target.value)}
          aria-label="Preço mínimo"
        />
        <input
          placeholder="Preço máx. (R$)"
          value={max}
          onChange={(e) => setMax(e.target.value)}
          aria-label="Preço máximo"
        />
      </div>
      {error && <div className="alert error">{error}</div>}
      {lots === null ? (
        <p>Carregando…</p>
      ) : lots.length === 0 ? (
        <p className="muted">
          Nenhum lote {TABS.find((t) => t[0] === phase)[1].toLowerCase()} no momento.
        </p>
      ) : (
        <div className="grid">
          {lots.map((l) => (
            <LotCard key={l.id} lot={l} />
          ))}
        </div>
      )}
    </>
  );
}
