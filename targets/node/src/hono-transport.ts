import { isBrewOutputPath } from '../../../packages/core/src/brew-output-paths.js';
import { isArticleOutputPath } from '../../../packages/core/src/article-outputs.js';
import { isReaderPageOutputPath } from '../../../packages/core/src/reader-pages.js';
import { isAppPageOutputPath } from '../../../packages/core/src/app-pages.js';
import type { createApi } from '../../../packages/api/src/app.js';
import { isJsonContentType } from '../../../packages/api/src/http.js';
import type { FastifyInstance, RouteHandlerMethod } from 'fastify';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { MAX_INBOUND_REQUEST_BYTES } from './services/inbound-webhook.js';
import { opmlDocumentLimit } from '../../../packages/core/src/opml.js';

// Fastify owns the socket, request-size/content-type parsing, and static files.
// The portable Hono app owns all API routing and response contracts.
export function mountApi(server: FastifyInstance, api: ReturnType<typeof createApi>): void {
  const handler: RouteHandlerMethod = async (request, reply) => {
    const path = request.url.split('?')[0]!;
    if (path.startsWith('/b/') && !isBrewOutputPath(path)) return reply.callNotFound();
    if (path.startsWith('/a/') && !isArticleOutputPath(path)) return reply.callNotFound();
    if ((path.startsWith('/f/') || path.startsWith('/feed/')) && !isReaderPageOutputPath(path)) return reply.callNotFound();
    if ((path.startsWith('/rules/') || path.startsWith('/settings/') || path.startsWith('/letters/')) && !isAppPageOutputPath(path)) return reply.callNotFound();
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
      new Request(new URL(request.url, `${request.protocol}://${request.host}`), {
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
  // A confirmed OPML action carries up to 1 MB of XML in a JSON envelope.
  server.post('/api/actions', { bodyLimit: opmlDocumentLimit * 2 + 4096 }, handler);
  server.all('/api/*', handler);
  server.all('/b/*', handler);
  server.all('/a/*', handler);
  for (const path of ['/all', '/today', '/starred', '/search'])
    for (const format of ['md', 'json']) server.all(`${path}.${format}`, handler);
  server.all('/f/*', handler);
  server.all('/feed/*', handler);
  for (const path of ['/index', '/reader', '/feeds', '/letters', '/rules'])
    for (const format of ['md', 'json']) server.all(`${path}.${format}`, handler);
  server.all('/rules/*', handler);
  server.all('/settings/*', handler);
  server.all('/letters/*', handler);
}
