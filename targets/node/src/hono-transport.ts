import type { createApi } from '../../../packages/api/src/app.js';
import { isJsonContentType } from '../../../packages/api/src/http.js';
import type { FastifyInstance, RouteHandlerMethod } from 'fastify';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { MAX_INBOUND_REQUEST_BYTES } from './services/inbound-webhook.js';

// Fastify owns the socket, request-size/content-type parsing, and static files.
// The portable Hono app owns all API routing and response contracts.
export function mountApi(server: FastifyInstance, api: ReturnType<typeof createApi>): void {
  const handler: RouteHandlerMethod = async (request, reply) => {
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
      ? Buffer.isBuffer(request.body)
        ? new Uint8Array(request.body)
        : isJsonContentType(headers.get('content-type'))
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
  };
  // Signed JSON must reach Hono byte-for-byte. Keep legacy parsing/limits on
  // every other route, with a scoped raw parser for inbound provider posts.
  void server.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      ['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data'],
      { parseAs: 'buffer', bodyLimit: MAX_INBOUND_REQUEST_BYTES },
      (_request, value, done) => done(null, value),
    );
    for (const url of ['/api/inbound/email', '/api/inbound/email/json', '/api/inbound/email/mime'])
      scope.post(url, { bodyLimit: MAX_INBOUND_REQUEST_BYTES }, handler);
  });
  server.all('/api/*', handler);
}
