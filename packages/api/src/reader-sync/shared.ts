import type { Context } from 'hono';
import type { ApiServices } from '../ports.js';
import {
  ReaderSyncError,
  type ReaderSession,
  type ReaderSyncPort,
} from '../../../core/src/reader-sync.js';
import { json } from '../http.js';
export type ReaderSyncServices = Pick<
  ApiServices,
  'readerSync' | 'outputBaseUrl' | 'feeds' | 'opml' | 'actions'
>;
import { ActionError } from '../../../core/src/actions.js';

export async function syncParameters(c: Context): Promise<URLSearchParams> {
  const params = new URL(c.req.url).searchParams;
  if (c.req.method === 'POST') {
    const media = c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase();
    let entries: Array<[string, string]> = [];
    if (media === 'application/x-www-form-urlencoded') {
      const text = await c.req.text();
      if (text.length > 1_048_576) throw new ReaderSyncError(413, 'Reader request is too large.');
      entries = [...new URLSearchParams(text)];
    } else if (media === 'multipart/form-data') {
      for (const [key, value] of await c.req.raw.formData()) {
        if (typeof value !== 'string')
          throw new ReaderSyncError(400, 'Reader fields must be text.');
        entries.push([key, value]);
      }
    } else if ((await c.req.text()).length)
      throw new ReaderSyncError(415, 'Use a URL-encoded reader form.');
    for (const key of new Set(entries.map(([key]) => key))) params.delete(key);
    for (const [key, value] of entries) params.append(key, value);
  }
  for (const name of ['T', 'api_key', 'Email', 'Passwd'])
    if (params.getAll(name).length > 1)
      throw new ReaderSyncError(400, 'Repeat only reader item, tag or stream fields.');
  if ([...params].length > 30_100) throw new ReaderSyncError(413, 'Too many reader fields.');
  return params;
}
export function integer(value: string | null, fallback: number, max = Number.MAX_SAFE_INTEGER) {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max)
    throw new ReaderSyncError(400, 'Invalid reader numeric parameter.');
  return Number(value);
}
export function syncBoundary(c: Context, publicUrl?: string, owner = false) {
  const url = new URL(c.req.url),
    origin = c.req.header('origin');
  const canonical = publicUrl ? new URL(publicUrl).origin : undefined;
  const hosts = [
    'localhost',
    '127.0.0.1',
    '[::1]',
    ...(canonical ? [new URL(canonical).hostname] : []),
  ];
  if (
    !hosts.includes(url.hostname) ||
    (origin && origin !== url.origin && origin !== canonical) ||
    c.req.header('sec-fetch-site') === 'cross-site' ||
    (owner && !['GET', 'HEAD'].includes(c.req.method) && !origin)
  )
    throw new ReaderSyncError(403, 'Use reader access on this instance.');
}
export async function readerPort(services: Pick<ApiServices, 'readerSync'>) {
  if (!services.readerSync)
    throw new ReaderSyncError(501, 'Reader sync needs setup on this instance.');
  return services.readerSync;
}
export async function readerSession(
  c: Context,
  port: ReaderSyncPort,
  params: URLSearchParams,
  write = false,
) {
  const session = await port.access.session(
    c.req.header('authorization') ?? null,
    c.req.method === 'POST' ? (params.get('T') ?? undefined) : undefined,
  );
  if (!session) {
    c.header('WWW-Authenticate', 'GoogleLogin realm="Brew Reader"');
    throw new ReaderSyncError(401, 'Reader authentication required.');
  }
  // Reeder's FreshRSS adapter uses T=x with its authenticated header.
  // That placeholder can never authenticate a T-only request.
  const reederToken = params.get('T') === 'x' && !session.writeOnly;
  if (write && !reederToken && !(await port.access.checkWrite(session, params.get('T') ?? '')))
    throw new ReaderSyncError(403, 'Fetch a current Reader write token first.');
  return session;
}
export function syncFailure(c: Context, error: unknown) {
  return error instanceof ReaderSyncError || error instanceof ActionError
    ? json(c, { error: error.message }, error.status)
    : json(c, { error: 'Could not complete reader sync. Retry the request.' }, 503);
}
export function readerActionContext(c: Context, session: ReaderSession) {
  return {
    agent: 'reader' as const,
    name: 'Reader sync',
    readerGeneration: session.generation,
    signal: c.req.raw.signal,
  };
}
