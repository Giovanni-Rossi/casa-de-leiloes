import { describe, expect, it, vi } from 'vitest';
import { ApiError, api, getToken, setToken } from '../src/api.js';

const respond = (ok, status, body) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, status, json: async () => body })),
  );

describe('api', () => {
  it('token: salva, lê e remove', () => {
    expect(getToken()).toBeNull();
    setToken('abc');
    expect(getToken()).toBe('abc');
    setToken(null);
    expect(getToken()).toBeNull();
  });

  it('tolera localStorage bloqueado', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(getToken()).toBeNull();
    expect(() => setToken('x')).not.toThrow();
    expect(() => setToken(null)).not.toThrow();
  });

  it('envia JSON e o token; devolve o corpo', async () => {
    setToken('tok');
    respond(true, 200, { ok: 1 });
    expect(await api('/x', { method: 'POST', body: { a: 1 } })).toEqual({ ok: 1 });
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('/api/x');
    expect(opts.method).toBe('POST');
    expect(opts.body).toBe('{"a":1}');
    expect(opts.headers.Authorization).toBe('Bearer tok');
  });

  it('sem token e sem corpo: GET simples', async () => {
    respond(true, 200, {});
    await api('/y');
    const [, opts] = fetch.mock.calls[0];
    expect(opts.method).toBe('GET');
    expect(opts.body).toBeUndefined();
    expect(opts.headers.Authorization).toBeUndefined();
  });

  it('erro da API vira ApiError com status e código', async () => {
    respond(false, 422, { error: { code: 'below_minimum', message: 'Abaixo' } });
    await expect(api('/z')).rejects.toMatchObject({
      status: 422,
      code: 'below_minimum',
      message: 'Abaixo',
    });
    await expect(api('/z')).rejects.toBeInstanceOf(ApiError);
  });

  it('erro sem corpo JSON usa mensagem padrão', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('html');
        },
      })),
    );
    await expect(api('/z')).rejects.toMatchObject({ status: 502, message: 'Erro inesperado' });
    respond(false, 500, {});
    await expect(api('/z')).rejects.toMatchObject({ message: 'Erro inesperado' });
  });

  it('falha de rede', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('x');
      }),
    );
    await expect(api('/z')).rejects.toMatchObject({ status: 0, code: 'network' });
  });
});
