import { useEffect, useRef, useState } from 'react';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (cents) => brl.format((cents ?? 0) / 100);

/** "1.234,56" | "1234.56" | "1234" -> centavos (ou null se inválido). */
export function parseMoney(text) {
  let s = String(text)
    .trim()
    .replace(/[R$\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

export const dateTime = (iso) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function formatRemaining(ms) {
  if (ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${d > 0 ? `${d}d ` : ''}${hh}:${mm}:${ss}`;
}

/** Contagem regressiva alinhada ao relógio do servidor (não depende do relógio do navegador). */
export function useCountdown(targetIso, serverNowIso) {
  const offset = useRef(0);
  const seen = useRef(null);
  if (serverNowIso && seen.current !== serverNowIso) {
    seen.current = serverNowIso;
    offset.current = new Date(serverNowIso).getTime() - Date.now();
  }
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);
  return targetIso ? new Date(targetIso).getTime() - (Date.now() + offset.current) : 0;
}

/** Assina um stream SSE; reconecta sozinho (EventSource) e dispara onEvent a cada mensagem. */
export function useStream(url, events, onEvent) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const eventsKey = events.join(','); // `events` costuma ser um array novo a cada render
  useEffect(() => {
    const es = new EventSource(url);
    const fn = () => handler.current();
    eventsKey.split(',').forEach((e) => es.addEventListener(e, fn));
    return () => es.close();
  }, [url, eventsKey]);
}

export function usePoll(fn, ms) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}
