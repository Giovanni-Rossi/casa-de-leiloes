import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { api } from '../api.js';
import { money } from '../util.js';

export default function Audit() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/audit/${id}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <p>Verificando…</p>;
  const bad = new Set(data.problems.map((p) => p.seq).filter(Boolean));

  return (
    <>
      <h1>Auditoria do lote</h1>
      <p className="lead">
        <Link to={`/lotes/${data.lot.id}`}>{data.lot.title}</Link> · {data.lot.bidCount} lance(s)
      </p>
      {data.intact ? (
        <div className="alert ok with-icon">
          <ShieldCheck size={20} aria-hidden="true" />
          Histórico ÍNTEGRO — a cadeia de hashes confere com o registrado no lote.
        </div>
      ) : (
        <div className="alert error">
          <div className="with-icon">
            <ShieldAlert size={20} aria-hidden="true" />
            HISTÓRICO ADULTERADO
          </div>
          <ul>
            {data.problems.map((p, i) => (
              <li key={i}>
                {p.seq ? `Lance #${p.seq}: ` : ''}
                {p.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="muted">
        Cada lance carrega um HMAC-SHA256 que inclui o hash do lance anterior. Alterar, remover ou
        inserir qualquer lance quebra a cadeia. Licitantes aparecem apenas por pseudônimo, diferente
        em cada lote.
      </p>
      <div className="table-wrap stack">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Licitante</th>
              <th>Valor</th>
              <th>Data/hora</th>
              <th>Hash</th>
            </tr>
          </thead>
          <tbody>
            {data.bids.map((b) => (
              <tr key={b.seq} className={bad.has(b.seq) ? 'row-bad' : undefined}>
                <td data-label="#">{b.seq}</td>
                <td data-label="Licitante">{b.bidder}</td>
                <td data-label="Valor" className="num">
                  {money(b.amountCents)}
                </td>
                <td data-label="Data/hora" className="num">
                  {new Date(b.at).toLocaleString('pt-BR')}
                </td>
                <td data-label="Hash" className="mono">
                  {b.hash.slice(0, 16)}…
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hash-box">
        <span className="label">Hash final registrado no lote</span>
        <span className="mono">{data.headHash ?? '—'}</span>
      </div>
    </>
  );
}
