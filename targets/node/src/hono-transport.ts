import type { createApi } from '../../../packages/api/src/app.js';
import { isJsonContentType } from '../../../packages/api/src/http.js';
import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

// Fastify owns the socket, request-size/content-type parsing, and static files.
// The portable Hono app owns all API routing and response contracts.
export function mountApi(server: FastifyInstance, api: ReturnType<typeof createApi>): void {
  server.all('/api/*', async (request, reply) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    reply.raw.once('close', abort);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    const hasBody =
      request.body !== undefined && request.method !== 'GET' && request.method !== 'HEAD';
    const body = hasBody
      ? isJsonContentType(headers.get('content-type'))
        ? JSON.stringify(request.body)
        : String(request.body)
      : undefined;
    const response = await api.fetch(
      new Request(`http://brew.internal${request.url}`, {
        method: request.method,
        headers,
        body,
        signal: controller.signal,
      }),
    );
    reply.code(response.status);
    response.headers.forEach((value, name) => reply.header(name, value));
    if (response.headers.get('content-type') === 'text/event-stream' && response.body) {
      return reply.send(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>));
    }
    reply.raw.removeListener('close', abort);
    return response.body ? reply.send(Buffer.from(await response.arrayBuffer())) : reply.send();
  });
}
