/* global self, clients, Response, MessageChannel, URL, setTimeout, clearTimeout */
const owners = new Map();
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));
self.addEventListener('message', (event) => {
  if (event.data?.kind === 'brew-claim' && event.source?.url.startsWith(self.registration.scope))
    event.waitUntil(clients.claim());
  if (
    event.data?.kind === 'brew-owner' &&
    event.source?.id &&
    event.source.url.startsWith(self.registration.scope)
  ) {
    owners.clear();
    owners.set(event.source.id, event.data.key);
    event.ports[0]?.postMessage({ ok: true });
  }
  if (
    event.data?.kind === 'brew-owner-close' &&
    event.source?.id &&
    owners.get(event.source.id) === event.data.key
  )
    owners.delete(event.source.id);
});
async function owner(clientId) {
  if (owners.has(clientId)) {
    const client = await clients.get(clientId);
    if (client) return { client, key: owners.get(clientId) };
    owners.delete(clientId);
  }
  const active = [];
  for (const [id, key] of owners) {
    const client = await clients.get(id);
    if (client) active.push({ client, key });
    else owners.delete(id);
  }
  // Workers can restart after being idle. Rediscover the live owner without persisting keys or data.
  if (!active.length) {
    const windows = await clients.matchAll({ type: 'window' });
    const found = await Promise.all(
      windows
        .filter((client) => client.url.startsWith(self.registration.scope))
        .map(
          (client) =>
            new Promise((resolve) => {
              const channel = new MessageChannel();
              const timer = setTimeout(() => finish(null), 1000);
              function finish(key) {
                clearTimeout(timer);
                channel.port1.close();
                resolve(key ? { client, key } : null);
              }
              channel.port1.onmessage = (event) => finish(event.data?.key);
              client.postMessage({ kind: 'brew-owner-probe' }, [channel.port2]);
            }),
        ),
    );
    for (const item of found)
      if (item) {
        owners.set(item.client.id, item.key);
        active.push(item);
      }
  }
  // A nested preview shares its top-level library; no background database is opened.
  if (active.length === 1) return active[0];
  return null;
}
async function localResponse(event) {
  const active = await owner(event.clientId);
  if (!active)
    return Response.json(
      { error: 'Open your Brew library to use this local address.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  const url = new URL(event.request.url);
  const local = new URL('__local/', self.registration.scope).pathname;
  if (url.pathname.startsWith(local)) url.pathname = '/' + url.pathname.slice(local.length);
  const request = event.request;
  const body = ['GET', 'HEAD'].includes(request.method)
    ? undefined
    : new Uint8Array(await request.arrayBuffer());
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(
      () => finish(Response.json({ error: 'The local library did not respond.' }, { status: 504 })),
      30000,
    );
    function finish(response) {
      clearTimeout(timer);
      channel.port1.close();
      resolve(response);
    }
    channel.port1.onmessage = ({ data }) => {
      if (!data.ok)
        return finish(
          Response.json(
            { error: data.error },
            { status: 503, headers: { 'Cache-Control': 'no-store' } },
          ),
        );
      const value = data.response;
      finish(
        new Response(
          request.method === 'HEAD' || [204, 205, 304].includes(value.status) ? null : value.body,
          value,
        ),
      );
    };
    active.client.postMessage(
      {
        kind: 'brew-api',
        key: active.key,
        request: { url: url.href, method: request.method, headers: [...request.headers], body },
      },
      [channel.port2],
    );
  });
}
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/api/') ||
      url.pathname.startsWith(new URL('__local/', self.registration.scope).pathname) ||
      (/^\/(?:b\/|reader|articles\/|rules|feeds|letters|settings|llms|openapi)/.test(
        url.pathname,
      ) &&
        /\.(md|json|txt)$/.test(url.pathname)))
  )
    event.respondWith(localResponse(event));
});
