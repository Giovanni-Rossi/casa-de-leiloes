import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Attributes, LotImage, PhaseBadge } from '../components.jsx';
import { dateTime, money, parseMoney, usePoll } from '../util.js';

// valor para <input type="datetime-local"> (horário local) a partir de um Date
const localInput = (d) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export default function Seller() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [source, setSource] = useState('');
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState(null);
  const [form, setForm] = useState({ start: '', end: '', startingBid: '', increment: '' });
  const [msg, setMsg] = useState(null);
  const [mine, setMine] = useState({ lots: [], totalReceivedCents: 0 });

  const loadMine = useCallback(
    () =>
      api('/seller/lots')
        .then(setMine)
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    loadMine();
  }, [loadMine]);
  usePoll(loadMine, 5000);

  async function search(e) {
    e.preventDefault();
    if (!q.trim()) return;
    setSearching(true);
    setMsg(null);
    try {
      const d = await api(`/catalog/search?q=${encodeURIComponent(q)}`);
      setResults(d.items);
      setSource(d.source);
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    } finally {
      setSearching(false);
    }
  }

  function pick(item) {
    const now = new Date();
    setPicked(item);
    setForm({
      start: localInput(now),
      end: localInput(new Date(now.getTime() + 60 * 60000)),
      startingBid: '',
      increment: '',
    });
    setMsg(null);
  }

  async function create(e) {
    e.preventDefault();
    const startingBidCents = parseMoney(form.startingBid);
    const minIncrementCents = parseMoney(form.increment);
    if (!startingBidCents || !minIncrementCents)
      return setMsg({ kind: 'error', text: 'Informe lance inicial e incremento válidos.' });
    try {
      await api('/lots', {
        method: 'POST',
        body: {
          ...picked,
          startingBidCents,
          minIncrementCents,
          startsAt: new Date(form.start).toISOString(),
          endsAt: new Date(form.end).toISOString(),
        },
      });
      setMsg({ kind: 'ok', text: 'Lote criado!' });
      setPicked(null);
      loadMine();
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    }
  }

  async function cancel(lot) {
    const warning =
      lot.bidCount > 0
        ? `Este lote já tem ${lot.bidCount} lance(s). Cancelar libera automaticamente o saldo do líder. Continuar?`
        : 'Cancelar este lote?';
    if (!window.confirm(warning)) return;
    try {
      await api(`/lots/${lot.id}/cancel`, { method: 'POST' });
      loadMine();
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <>
      <h1>Painel do leiloeiro</h1>
      <div className="stats">
        <div className="card stat">
          <div className="stat-label">Total recebido</div>
          <div className="v">{money(mine.totalReceivedCents)}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Lotes criados</div>
          <div className="v">{mine.lots.length}</div>
        </div>
      </div>
      {msg && <div className={`alert ${msg.kind}`}>{msg.text}</div>}

      <div className="seller-grid">
        <section className="card">
          <span className="eyebrow">Etapa 1</span>
          <h2>Buscar item na API</h2>
          <form className="row" onSubmit={search}>
            <input
              placeholder="Ex.: monet, vase, samurai, egypt…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Buscar item"
            />
            <button className="primary" disabled={searching}>
              {searching ? 'Buscando…' : 'Buscar'}
            </button>
          </form>
          {source === 'cache' && (
            <div className="alert warn">
              A API externa está indisponível — mostrando itens já salvos no cache local.
            </div>
          )}
          {results?.length === 0 && <p className="muted">Nada encontrado.</p>}
          {results?.length > 0 && (
            <div className="result-list">
              {results.map((it) => (
                <div className="result-item" key={it.externalId}>
                  <LotImage src={it.imageUrl} alt={it.title} />
                  <div className="info">
                    <strong>{it.title}</strong>
                    <span className="muted">
                      {it.attributes?.Artista ?? it.attributes?.Tipo ?? ''}
                    </span>
                  </div>
                  <button onClick={() => pick(it)}>Usar</button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <span className="eyebrow">Etapa 2</span>
          <h2>Criar lote</h2>
          {!picked ? (
            <p className="muted">Escolha um item ao lado.</p>
          ) : (
            <form onSubmit={create}>
              <div className="picked">
                <div className="frame">
                  <LotImage src={picked.imageUrl} alt={picked.title} />
                </div>
                <div>
                  <div className="picked-title">{picked.title}</div>
                  <Attributes attributes={picked.attributes} />
                </div>
              </div>
              <div className="form-grid">
                <label>
                  Lance inicial (R$)
                  <input
                    inputMode="decimal"
                    value={form.startingBid}
                    onChange={set('startingBid')}
                    required
                  />
                </label>
                <label>
                  Incremento mínimo (R$)
                  <input
                    inputMode="decimal"
                    value={form.increment}
                    onChange={set('increment')}
                    required
                  />
                </label>
              </div>
              <div className="form-grid">
                <label>
                  Início
                  <input
                    type="datetime-local"
                    value={form.start}
                    onChange={set('start')}
                    required
                  />
                </label>
                <label>
                  Fim
                  <input type="datetime-local" value={form.end} onChange={set('end')} required />
                </label>
              </div>
              <button className="primary">Publicar lote</button>
            </form>
          )}
        </section>
      </div>

      <h2>Meus lotes</h2>
      {mine.lots.length === 0 ? (
        <p className="muted">Você ainda não criou lotes.</p>
      ) : (
        <div className="table-wrap stack">
          <table>
            <thead>
              <tr>
                <th>Lote</th>
                <th>Situação</th>
                <th>Lance atual</th>
                <th>Resultado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {mine.lots.map((l) => (
                <tr key={l.id}>
                  <td data-label="Lote">
                    <Link to={`/lotes/${l.id}`}>{l.title}</Link>
                    <div className="muted">
                      {dateTime(l.startsAt)} até {dateTime(l.endsAt)}
                    </div>
                  </td>
                  <td data-label="Situação">
                    {l.status === 'cancelled' ? (
                      <span className="badge">Cancelado</span>
                    ) : (
                      <PhaseBadge lot={l} />
                    )}
                  </td>
                  <td data-label="Lance atual" className="num">
                    {l.currentBidCents ? money(l.currentBidCents) : '—'}{' '}
                    <span className="muted">({l.bidCount})</span>
                  </td>
                  <td data-label="Resultado">
                    {l.status === 'settled' ? (
                      l.sold ? (
                        <strong>Arrematado por {money(l.finalCents)}</strong>
                      ) : (
                        'Sem lances — sem vencedor'
                      )
                    ) : (
                      '—'
                    )}
                  </td>
                  <td data-label="Ações">
                    {l.status === 'active' && l.phase !== 'ended' && (
                      <button className="danger" onClick={() => cancel(l)}>
                        Cancelar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
