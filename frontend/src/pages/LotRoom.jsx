import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CircleCheck, CircleX, ExternalLink, ShieldCheck, Trophy } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Attributes, LotImage, PhaseBadge } from '../components.jsx';
import {
  dateTime,
  formatRemaining,
  money,
  parseMoney,
  useCountdown,
  usePoll,
  useStream,
} from '../util.js';

const FEEDBACK = {
  below_minimum: 'Lance abaixo do mínimo.',
  insufficient_funds: 'Saldo insuficiente — deposite na sua carteira.',
  already_leading: 'Você já está ganhando este lote.',
  lot_not_started: 'Este lote ainda não foi iniciado.',
  lot_ended: 'Lote encerrado.',
  lot_cancelled: 'Este lote foi cancelado.',
};

export default function LotRoom() {
  const { id } = useParams();
  const { user } = useAuth();
  const [lot, setLot] = useState(null);
  const [bids, setBids] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [amount, setAmount] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [l, b] = await Promise.all([api(`/lots/${id}`), api(`/lots/${id}/bids`)]);
      setLot(l.lot);
      setBids(b.bids);
      if (user?.role === 'licitante') setWallet(await api('/wallet'));
    } catch (e) {
      if (e.status === 404) setNotFound(true);
    }
  }, [id, user]);

  useEffect(() => {
    load();
  }, [load]);
  useStream(`/api/lots/${id}/stream`, ['bid', 'settled', 'cancelled', 'lot'], load);
  usePoll(load, 5000);

  const target = lot?.phase === 'scheduled' ? lot.startsAt : lot?.endsAt;
  const remaining = useCountdown(target, lot?.serverNow);
  // Quando o relógio zera, busca o novo estado (início, fim, prorrogação ou liquidação).
  const expired = remaining <= 0;
  useEffect(() => {
    if (lot && lot.phase !== 'ended' && expired) {
      const t = setTimeout(load, 700);
      return () => clearTimeout(t);
    }
  }, [lot, expired, load]);

  if (notFound) return <p>Lote não encontrado ou cancelado.</p>;
  if (!lot) return <p>Carregando…</p>;

  // Posição = 1 + licitantes distintos cujo melhor lance supera o meu (o melhor de cada um é o mais recente).
  const best = new Map();
  bids.forEach((b) => best.set(b.bidder, Math.max(best.get(b.bidder) ?? 0, b.amountCents)));
  const mineBids = bids.filter((b) => b.mine);
  const myBest = mineBids.length ? Math.max(...mineBids.map((b) => b.amountCents)) : null;
  const myPosition =
    myBest === null ? null : 1 + [...best.values()].filter((v) => v > myBest).length;
  async function submit(e) {
    e.preventDefault();
    const cents = parseMoney(amount);
    if (!cents) return setFeedback({ kind: 'error', text: 'Informe um valor válido.' });
    setBusy(true);
    try {
      const r = await api(`/lots/${id}/bids`, { method: 'POST', body: { amountCents: cents } });
      setFeedback({
        kind: 'ok',
        text: r.extended ? 'Lance aceito! O lote foi prorrogado em +2 minutos.' : 'Lance aceito!',
      });
      setAmount('');
      load();
    } catch (err) {
      setFeedback({ kind: 'error', text: FEEDBACK[err.code] ?? err.message });
      load();
    } finally {
      setBusy(false);
    }
  }

  const canBid = user?.role === 'licitante' && lot.phase === 'live';
  const urgent = lot.phase === 'live' && remaining < 120000;

  return (
    <div className="room">
      <div className="room-media">
        <div className="frame">
          <LotImage className="hero" src={lot.imageUrl} alt={lot.title} />
        </div>
        {lot.description && <p className="lot-description">{lot.description}</p>}
        <Attributes attributes={lot.attributes} />
        {lot.sourceUrl && (
          <a className="with-icon" href={lot.sourceUrl} target="_blank" rel="noreferrer">
            Ver item na fonte original
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
      </div>

      <div className="card room-panel">
        <div className="room-panel-head">
          <span className="lot-no">Lote Nº {lot.id}</span>
          <PhaseBadge lot={lot} />
        </div>
        <h1>{lot.title}</h1>
        <hr className="rule" />

        {lot.phase !== 'ended' && (
          <>
            <div className="label">{lot.phase === 'scheduled' ? 'Começa em' : 'Termina em'}</div>
            <div className={`countdown ${urgent ? 'urgent' : ''}`} aria-live="polite">
              {formatRemaining(remaining)}
            </div>
            <div className="muted">
              {lot.phase === 'scheduled' ? dateTime(lot.startsAt) : `Fim: ${dateTime(lot.endsAt)}`}
            </div>
          </>
        )}

        <hr className="rule" />
        <div>
          <div className="label">{lot.currentBidCents ? 'Lance atual' : 'Lance inicial'}</div>
          <div className="price large">{money(lot.currentBidCents ?? lot.startingBidCents)}</div>
          <div className="muted">
            {lot.bidCount} lance(s) · incremento mínimo {money(lot.minIncrementCents)}
            {lot.leader && <> · líder: {lot.leader}</>}
          </div>
        </div>

        {lot.status === 'settled' && (
          <div className={`alert ${lot.sold ? 'ok' : 'warn'}`}>
            {lot.sold
              ? `Arrematado por ${money(lot.finalCents)}`
              : 'Encerrado sem lances — sem vencedor.'}
          </div>
        )}
        {lot.myStatus === 'leading' && lot.phase !== 'ended' && (
          <div className="status-banner leading">
            <CircleCheck size={20} aria-hidden="true" />
            Você está ganhando!
          </div>
        )}
        {lot.myStatus === 'outbid' && lot.phase !== 'ended' && (
          <div className="status-banner outbid">
            <CircleX size={20} aria-hidden="true" />
            Você foi superado.
          </div>
        )}
        {myPosition && lot.phase !== 'ended' && (
          <p className="muted">
            Sua posição: <strong>{myPosition}º</strong> de {best.size} licitante(s) · seu melhor
            lance: {money(myBest)}
          </p>
        )}
        {lot.myStatus === 'leading' && lot.status === 'settled' && (
          <div className="status-banner leading">
            <Trophy size={20} aria-hidden="true" />
            Você venceu este lote! Veja o comprovante em “Meus arremates”.
          </div>
        )}

        {canBid && (
          <form className="bid-form" onSubmit={submit}>
            <label>
              Seu lance (mínimo {money(lot.nextMinBidCents)})
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={money(lot.nextMinBidCents)}
              />
            </label>
            <div className="actions">
              <button className="primary" disabled={busy}>
                Dar lance
              </button>
              <button
                type="button"
                onClick={() => setAmount(String(lot.nextMinBidCents / 100).replace('.', ','))}
              >
                Lance mínimo
              </button>
            </div>
            {wallet && (
              <p className="muted">
                Saldo disponível: {money(wallet.availableCents)} (
                <Link to="/carteira">depositar</Link>)
              </p>
            )}
          </form>
        )}
        {!user && lot.phase !== 'ended' && (
          <p>
            <Link to="/entrar">Entre</Link> como licitante para dar lances.
          </p>
        )}
        {user?.role === 'leiloeiro' && <p className="muted">Leiloeiros não podem dar lances.</p>}
        {feedback && (
          <div className={`alert ${feedback.kind}`} role="status">
            {feedback.text}
          </div>
        )}

        <h3 className="panel-section-title">Histórico de lances</h3>
        {bids.length === 0 ? (
          <p className="muted">Nenhum lance ainda.</p>
        ) : (
          <div className="table-wrap compact">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Licitante</th>
                  <th>Valor</th>
                  <th>Quando</th>
                </tr>
              </thead>
              <tbody>
                {bids.map((b) => (
                  <tr key={b.seq} className={b.mine ? 'mine' : undefined}>
                    <td>{b.seq}</td>
                    <td>
                      {b.bidder}
                      {b.mine && ' (você)'}
                    </td>
                    <td className="num">{money(b.amountCents)}</td>
                    <td className="num">{new Date(b.at).toLocaleTimeString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p>
          <Link className="with-icon" to={`/auditoria/${lot.id}`}>
            <ShieldCheck size={16} aria-hidden="true" />
            Auditar integridade do histórico
          </Link>
        </p>
      </div>
    </div>
  );
}
