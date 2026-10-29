import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, CircleCheck, CircleX, Copy, FileText, Trophy } from 'lucide-react';
import { api } from '../api.js';
import { LotImage } from '../components.jsx';
import { money, usePoll } from '../util.js';

function statusOf(l) {
  if (l.won) return { cls: 'ok', text: 'Você venceu', Icon: Trophy };
  if (l.phase === 'ended')
    return { cls: '', text: l.status === 'settled' ? 'Não arrematado' : 'Encerrando…' };
  if (l.myStatus === 'leading') return { cls: 'ok', text: 'Ganhando', Icon: CircleCheck };
  return { cls: 'live', text: 'Superado', Icon: CircleX };
}

export default function MyBids() {
  const [lots, setLots] = useState(null);
  const [copied, setCopied] = useState(null);
  const load = useCallback(
    () =>
      api('/my/bids')
        .then((d) => setLots(d.lots))
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  usePoll(load, 5000);

  const link = (token) => `${window.location.origin}/comprovante/${token}`;
  async function copy(token) {
    try {
      await navigator.clipboard.writeText(link(token));
      setCopied(token);
    } catch {
      window.prompt('Copie o link:', link(token));
    }
  }

  if (!lots) return <p>Carregando…</p>;
  const wins = lots.filter((l) => l.won);
  const others = lots.filter((l) => !l.won);
  const Row = ({ l }) => {
    const st = statusOf(l);
    return (
      <div className="card bid-row" key={l.id}>
        <div className="frame">
          <LotImage src={l.imageUrl} alt={l.title} />
        </div>
        <div className="bid-row-info">
          <Link className="bid-row-title" to={`/lotes/${l.id}`}>
            {l.title}
          </Link>
          <span className={`badge ${st.cls}`}>
            {st.Icon && <st.Icon size={13} aria-hidden="true" />}
            {st.text}
          </span>
          <div className="muted">
            {l.won
              ? `Arrematado por ${money(l.finalCents)}`
              : `Lance atual: ${money(l.currentBidCents)}`}
          </div>
        </div>
        {l.receiptToken && (
          <div className="row bid-row-actions">
            <Link className="btn with-icon" to={`/comprovante/${l.receiptToken}`}>
              <FileText size={16} aria-hidden="true" />
              Comprovante
            </Link>
            <button className="with-icon" onClick={() => copy(l.receiptToken)}>
              {copied === l.receiptToken ? (
                <>
                  <Check size={16} aria-hidden="true" />
                  Link copiado
                </>
              ) : (
                <>
                  <Copy size={16} aria-hidden="true" />
                  Copiar link
                </>
              )}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <h1>Meus arremates</h1>
      <h2>Lotes vencidos</h2>
      {wins.length === 0 ? (
        <p className="muted">Você ainda não venceu nenhum lote.</p>
      ) : (
        <div className="bid-list">
          {wins.map((l) => (
            <Row key={l.id} l={l} />
          ))}
        </div>
      )}
      <h2>Lotes em que dei lance</h2>
      {others.length === 0 ? (
        <p className="muted">Nenhum outro lote.</p>
      ) : (
        <div className="bid-list">
          {others.map((l) => (
            <Row key={l.id} l={l} />
          ))}
        </div>
      )}
    </>
  );
}
