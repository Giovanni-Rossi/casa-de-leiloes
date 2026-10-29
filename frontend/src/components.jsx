import React from 'react';
import { Link } from 'react-router-dom';
import { ImageOff } from 'lucide-react';
import { money, formatRemaining, useCountdown, dateTime } from './util.js';

export function LotImage({ src, alt, className }) {
  const [failed, setFailed] = React.useState(false);
  if (!src || failed)
    return (
      <div className={`img-placeholder ${className ?? ''}`}>
        <ImageOff size={28} strokeWidth={1.25} aria-hidden="true" />
        <span>sem imagem</span>
      </div>
    );
  return (
    <img className={className} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />
  );
}

export function PhaseBadge({ lot }) {
  if (lot.phase === 'live') {
    return (
      <span className="badge live">
        <span className="live-dot" aria-hidden="true" />
        AO VIVO
      </span>
    );
  }
  if (lot.phase === 'scheduled') return <span className="badge warn">Agendado</span>;
  if (lot.status === 'settled') {
    return lot.sold ? (
      <span className="badge ok">Arrematado</span>
    ) : (
      <span className="badge">Encerrado sem lances</span>
    );
  }
  return <span className="badge">Encerrando…</span>;
}

export function LotCard({ lot }) {
  const remaining = useCountdown(
    lot.phase === 'scheduled' ? lot.startsAt : lot.endsAt,
    lot.serverNow,
  );
  const price = lot.currentBidCents ?? lot.startingBidCents;
  return (
    <Link to={`/lotes/${lot.id}`} className="card lot-card">
      <div className="frame">
        <LotImage className="img" src={lot.imageUrl} alt={lot.title} />
      </div>
      <div className="body">
        <div className="lot-card-top">
          <span className="lot-no">Lote Nº {lot.id}</span>
          <PhaseBadge lot={lot} />
        </div>
        <h3>{lot.title}</h3>
        <div className="lot-card-foot">
          <div>
            <div className="label">{lot.currentBidCents ? 'Lance atual' : 'Lance inicial'}</div>
            <div className="price">
              {money(lot.status === 'settled' && lot.sold ? lot.finalCents : price)}
            </div>
          </div>
          <div className="muted time">
            {lot.phase === 'live' && <>Termina em {formatRemaining(remaining)}</>}
            {lot.phase === 'scheduled' && <>Começa em {formatRemaining(remaining)}</>}
            {lot.phase === 'ended' && <>{lot.bidCount} lance(s)</>}
          </div>
        </div>
      </div>
    </Link>
  );
}

export function Attributes({ attributes }) {
  const entries = Object.entries(attributes ?? {});
  if (!entries.length) return null;
  return (
    <dl className="attrs">
      {entries.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt>{k}</dt>
          <dd>{String(v)}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export { dateTime };
