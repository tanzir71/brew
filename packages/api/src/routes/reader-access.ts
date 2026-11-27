import type { Hono } from 'hono';
import type { ApiServices } from '../ports.js';
import { body, json } from '../http.js';
import { documented, errors, jsonBody, response } from '../openapi.js';
import { object, str, bool } from '../openapi-schemas.js';
import { readerPort, syncBoundary, syncFailure } from '../reader-sync/shared.js';
import { readerServerUrls } from '../../../core/src/reader-apps.js';

export function registerReaderAccess(app: Hono, services: ApiServices) {
  app.use('/api/reader-access', async (c, next) => {
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    await next();
  });
  app.get(
    '/api/reader-access',
    documented('Reader apps', 'Read app-password setup status', {
      responses: {
        200: response(
          object({
            enabled: bool,
            username: { type: ['string', 'null'] },
            serverUrl: str,
            googleReaderUrl: str,
            feverUrl: str,
          }),
        ),
        ...errors(403, 501),
      },
    }),
    async (c) => {
      try {
        syncBoundary(c, services.outputBaseUrl, true);
        return json(c, {
          ...(await (await readerPort(services)).access.status()),
          ...readerServerUrls(services.outputBaseUrl ?? c.req.url),
        });
      } catch (error) {
        return syncFailure(c, error);
      }
    },
  );
  app.post(
    '/api/reader-access',
    documented('Reader apps', 'Create or rotate the single-owner reader app password', {
      description:
        'Owner-only, same-origin operation. Returns a generated secret once; stores verifiers, invalidates all Reader sessions and the previous Fever key. This credential permits reader content/state and subscription access, never owner REST or MCP.',
      requestBody: jsonBody(object({ username: str })),
      responses: {
        200: response(object({ username: str, password: str })),
        ...errors(400, 403, 501),
      },
    }),
    async (c) => {
      try {
        syncBoundary(c, services.outputBaseUrl, true);
        return json(c, await (await readerPort(services)).access.configure(await body(c)));
      } catch (error) {
        return syncFailure(c, error);
      }
    },
  );
  app.delete(
    '/api/reader-access',
    documented('Reader apps', 'Disable reader app access and revoke all Reader sessions', {
      responses: { 200: response(object({ ok: bool })), ...errors(403, 501) },
    }),
    async (c) => {
      try {
        syncBoundary(c, services.outputBaseUrl, true);
        await (await readerPort(services)).access.disable();
        return json(c, { ok: true });
      } catch (error) {
        return syncFailure(c, error);
      }
    },
  );
}
