import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { api } from '../api.js';
import { Attributes, LotImage } from '../components.jsx';
import { dateTime, money } from '../util.js';

export default function Receipt() {
  const { token } = useParams();
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/receipts/${token}`)
      .then((d) => setR(d.receipt))
      .catch((e) => setError(e.message));
  }, [token]);

  if (error) return <div className="alert error">{error}</div>;
  if (!r) return <p>Carregando…</p>;
  return (
    <div className="certificate">
      <span className="eyebrow">Casa de Leilões</span>
      <h1>Comprovante de arremate</h1>
      <div className="ornament">
        <span />
      </div>
      <div className="frame">
        <LotImage className="hero" src={r.imageUrl} alt={r.title} />
      </div>
      <h2>{r.title}</h2>
      <div className="certificate-amount">
        <span className="label">Arrematado por</span>
        <div className="price large">{money(r.amountCents)}</div>
      </div>
      <Attributes attributes={r.attributes} />
      <dl className="attrs">
        <dt>Arrematante</dt>
        <dd>{r.winner}</dd>
        <dt>Leiloeiro</dt>
        <dd>{r.seller}</dd>
        <dt>Lances no lote</dt>
        <dd>{r.bidCount}</dd>
        <dt>Emitido em</dt>
        <dd>{dateTime(r.issuedAt)}</dd>
        <dt>Hash final</dt>
        <dd className="mono">{r.headHash}</dd>
      </dl>
      {r.auditIntact ? (
        <div className="alert ok with-icon">
          <ShieldCheck size={20} aria-hidden="true" />
          Histórico de lances íntegro.
        </div>
      ) : (
        <div className="alert error with-icon">
          <ShieldAlert size={20} aria-hidden="true" />O histórico deste lote foi adulterado!
        </div>
      )}
      <div className="ornament">
        <span />
      </div>
      <Link to={`/auditoria/${r.lotId}`}>Ver auditoria completa do lote</Link>
    </div>
  );
}
