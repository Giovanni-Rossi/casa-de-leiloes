import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { dateTime, money, parseMoney, usePoll } from '../util.js';

const TYPE = { deposit: 'Depósito', debit: 'Arremate (débito)', credit: 'Venda (crédito)' };

export default function Wallet() {
  const [wallet, setWallet] = useState(null);
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState(null);

  const load = useCallback(
    () =>
      api('/wallet')
        .then(setWallet)
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  usePoll(load, 5000);

  async function deposit(e) {
    e.preventDefault();
    const cents = parseMoney(amount);
    if (!cents) return setMsg({ kind: 'error', text: 'Informe um valor válido.' });
    try {
      setWallet({
        ...wallet,
        ...(await api('/wallet/deposit', { method: 'POST', body: { amountCents: cents } })),
      });
      setMsg({ kind: 'ok', text: `Depósito simulado de ${money(cents)} realizado.` });
      setAmount('');
      load();
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    }
  }

  if (!wallet) return <p>Carregando…</p>;
  return (
    <>
      <h1>Minha carteira</h1>
      <div className="stats">
        <div className="card stat">
          <div className="stat-label">Saldo total</div>
          <div className="v">{money(wallet.totalCents)}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Comprometido em lances</div>
          <div className="v">{money(wallet.committedCents)}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Disponível</div>
          <div className="v">{money(wallet.availableCents)}</div>
        </div>
      </div>
      <form className="card deposit" onSubmit={deposit}>
        <span className="eyebrow">Adicionar saldo</span>
        <h3>Depósito simulado</h3>
        <div className="inline-form">
          <input
            inputMode="decimal"
            placeholder="Valor em R$ (ex.: 1.000,00)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Valor do depósito"
          />
          <button className="primary">Depositar</button>
        </div>
        {msg && <div className={`alert ${msg.kind}`}>{msg.text}</div>}
      </form>
      <h2>Movimentações</h2>
      {wallet.transactions.length === 0 ? (
        <p className="muted">Nada por aqui ainda.</p>
      ) : (
        <div className="table-wrap stack">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Lote</th>
                <th>Valor</th>
              </tr>
            </thead>
            <tbody>
              {wallet.transactions.map((t) => (
                <tr key={t.id}>
                  <td data-label="Data">{dateTime(t.at)}</td>
                  <td data-label="Tipo">{TYPE[t.type]}</td>
                  <td data-label="Lote">{t.lotTitle ?? '—'}</td>
                  <td
                    data-label="Valor"
                    className={`num ${t.type === 'debit' ? 'amount-debit' : 'amount-credit'}`}
                  >
                    {t.type === 'debit' ? '−' : '+'}
                    {money(t.amountCents)}
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
