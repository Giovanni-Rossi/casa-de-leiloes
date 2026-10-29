const TOKEN_KEY = 'leilao.token';

// localStorage pode estar bloqueado (modo privado, política do navegador): sem ele o app segue funcionando, só sem sessão persistente.
export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* sem armazenamento: sessão só em memória */
  }
}

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'Sem conexão com o servidor');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new ApiError(res.status, data.error?.code, data.error?.message ?? 'Erro inesperado');
  return data;
}
