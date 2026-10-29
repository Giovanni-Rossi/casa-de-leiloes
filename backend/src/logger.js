import pino from 'pino';
import pretty from 'pino-pretty';
import { config } from './config.js';

/**
 * `destination` (opcional) recebe cada linha JSON — usado nos testes para capturar os logs.
 *
 * Logger estruturado (JSON em uma linha por evento).
 * - Produção: JSON em stdout, com `severity` e `message` — o Cloud Logging do GCP (e a maioria das
 *   plataformas) indexa esses campos sozinho, sem agente nem código extra.
 * - Desenvolvimento: formato legível e colorido (pino-pretty).
 * - Dados sensíveis nunca vão para o log (redact).
 */
export function createLogger({ level, pretty: usePretty, destination }) {
  const options = {
    level,
    messageKey: 'message',
    base: { service: 'casa-de-leiloes' }, // sem pid/hostname: ruído em contêiner
    timestamp: pino.stdTimeFunctions.isoTime, // RFC 3339, que o Cloud Logging interpreta como horário do evento
    formatters: { level: (label) => ({ severity: label.toUpperCase() }) },
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash'],
      censor: '[REDACTED]',
    },
  };
  if (usePretty) {
    return pino(
      { ...options, formatters: undefined },
      pretty({ colorize: true, messageKey: 'message', ignore: 'pid,hostname' }),
    );
  }
  return pino(options, destination);
}

export const logger = createLogger({ level: config.logLevel, pretty: config.logPretty });
