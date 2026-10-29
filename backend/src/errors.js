export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (code, message) => new HttpError(400, code, message);
export const forbidden = (message = 'Acesso negado') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Não encontrado') => new HttpError(404, 'not_found', message);
/** Regra de negócio violada (lance recusado, lote não cancelável…). */
export const rejection = (code, message) => new HttpError(422, code, message);
