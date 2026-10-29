import { EventEmitter } from 'node:events';

export const bus = new EventEmitter();
bus.setMaxListeners(0);

/** Canal "global" (vitrine) e canais por lote ("lot:<id>"). */
export const emitGlobal = (event, data) => bus.emit('global', { event, data });
export const emitLot = (lotId, event, data) => bus.emit(`lot:${lotId}`, { event, data });

export function sseHandler(channel, initial) {
  return async (req, res) => {
    // Resolve o canal ANTES de abrir o stream: um id inválido ainda vira um 404 normal.
    const name = channel(req);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const send = ({ event, data }) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const listener = (msg) => send(msg);
    bus.on(name, listener);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(heartbeat);
      bus.off(name, listener);
    });
    if (initial) send({ event: 'hello', data: await initial(req) });
  };
}
