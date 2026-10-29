import { logger } from './logger.js';
import { start } from './server.js';

// Erros que escapam de qualquer try/catch: registra com contexto e encerra (o orquestrador reinicia).
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'exceção não tratada');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'promise rejeitada sem tratamento');
  process.exit(1);
});

await start();
