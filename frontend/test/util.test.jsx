import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  dateTime,
  formatRemaining,
  money,
  parseMoney,
  useCountdown,
  usePoll,
  useStream,
} from '../src/util.js';
import { stubEventSource } from './helpers.jsx';

describe('formatação', () => {
  it('money formata centavos em reais (e trata null)', () => {
    expect(money(123456)).toMatch(/R\$\s?1\.234,56/);
    expect(money(null)).toMatch(/R\$\s?0,00/);
  });

  it('parseMoney aceita formatos brasileiro e simples', () => {
    expect(parseMoney('1.234,56')).toBe(123456);
    expect(parseMoney('R$ 10,5')).toBe(1050);
    expect(parseMoney('1234.56')).toBe(123456);
    expect(parseMoney('100')).toBe(10000);
    for (const bad of ['', '   ', 'abc', '0', '-5']) expect(parseMoney(bad)).toBeNull();
  });

  it('dateTime usa pt-BR', () => {
    expect(dateTime('2030-01-02T15:04:00')).toMatch(/02\/01\/2030/);
  });

  it('formatRemaining', () => {
    expect(formatRemaining(0)).toBe('00:00:00');
    expect(formatRemaining(-5)).toBe('00:00:00');
    expect(formatRemaining(3661000)).toBe('01:01:01');
    expect(formatRemaining(90061000)).toBe('1d 01:01:01');
  });
});

describe('hooks', () => {
  it('useCountdown: usa o relógio do servidor e atualiza a cada tick', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    const serverNow = '2030-01-01T00:10:00Z'; // servidor 10 min à frente do navegador
    const { result, rerender } = renderHook(({ t, s }) => useCountdown(t, s), {
      initialProps: { t: '2030-01-01T00:11:00Z', s: serverNow },
    });
    expect(result.current).toBe(60000);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(59000);
    rerender({ t: '2030-01-01T00:11:00Z', s: serverNow }); // mesma resposta: offset preservado
    expect(result.current).toBe(59000);
  });

  it('useCountdown: sem alvo => 0; sem serverNow => relógio local', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    expect(renderHook(() => useCountdown(null, null)).result.current).toBe(0);
    expect(renderHook(() => useCountdown('2030-01-01T00:00:30Z')).result.current).toBe(30000);
  });

  it('useStream assina eventos, chama o handler mais recente e fecha ao desmontar', () => {
    const ES = stubEventSource();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(({ cb }) => useStream('/api/s', ['bid', 'lot'], cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });
    const es = ES.instances[0];
    es.emit('bid');
    es.emit('lot');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(2);
    unmount();
    expect(es.closed).toBe(true);
  });

  it('usePoll chama periodicamente e para ao desmontar', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const { unmount } = renderHook(() => usePoll(fn, 1000));
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(3);
    unmount();
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
