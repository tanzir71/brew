import type { Context } from 'hono';
import type { EventsPort } from './ports.js';

export function eventStream(c: Context, events: EventsPort): Response {
  const headers = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  };
  if (c.req.method === 'HEAD') return c.body(null, 200, headers);
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe = () => {};
      const lifetime: { heartbeat?: ReturnType<typeof setInterval> } = {};
      const close = (closeController: boolean) => {
        if (closed) return;
        closed = true;
        clearInterval(lifetime.heartbeat);
        unsubscribe();
        c.req.raw.signal.removeEventListener('abort', onAbort);
        if (closeController) controller.close();
      };
      const onAbort = () => close(true);
      const write = (event: string, data: unknown) => {
        if (!closed)
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      cleanup = () => close(false);
      unsubscribe = events.subscribe(write, onAbort);
      if (closed) {
        unsubscribe();
        return;
      }
      if (c.req.raw.signal.aborted) {
        close(true);
        return;
      }
      c.req.raw.signal.addEventListener('abort', onAbort, { once: true });
      write('heartbeat', {});
      lifetime.heartbeat = setInterval(() => write('heartbeat', {}), 15_000);
    },
    cancel() {
      cleanup();
    },
  });
  return c.body(stream, 200, headers);
}
