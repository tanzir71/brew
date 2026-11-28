/* global Response, TextDecoder, URL, Headers, AbortSignal, fetch */
export default { async fetch(request, env) {
    const cors = { 'Access-Control-Allow-Origin': env.APP_ORIGIN, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Expose-Headers': 'ETag, Last-Modified, X-Brew-Relay, X-Brew-Feed-URL', 'Cache-Control': 'no-store', Vary: 'Origin' };
    const reply = (message, status) => new Response(message, { status, headers: { ...cors, 'X-Brew-Relay': 'relay-error' } }), sourceFailure = url => new Response('Upstream failed or exceeded limits', { status: 502, headers: { ...cors, 'X-Brew-Relay': 'upstream', 'X-Brew-Feed-URL': url.href } });
    if (!env.APP_ORIGIN || env.APP_ORIGIN === '*' || request.headers.get('Origin') !== env.APP_ORIGIN) return new Response('Origin denied', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply('POST required', 405);
    if (!env.RELAY_TOKEN || env.RELAY_TOKEN.length < 32 || request.headers.get('Authorization') !== `Bearer ${env.RELAY_TOKEN}`) return reply('Unauthorized', 401);
    const allowed = new Set((env.ALLOWED_HOSTS || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean));
    const valid = url => /^https?:$/.test(url.protocol) && !url.username && !url.password && !url.hash && allowed.has(url.host.toLowerCase());
    const read = async (body, limit) => {
      const reader = body?.getReader(), chunks = []; let size = 0;
      try { if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; if ((size += value.byteLength) > limit) throw new Error('Too large'); chunks.push(value); } }
      finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
    };
    try {
      const input = JSON.parse(new TextDecoder().decode(await read(request.body, 65536))), headers = new Headers();
      for (const key of ['accept', 'if-none-match', 'if-modified-since']) if (typeof input.headers?.[key] === 'string') headers.set(key, input.headers[key]);
      let url = new URL(input.url); const signal = AbortSignal.timeout(20000);
      for (let redirects = 0; redirects <= 5; redirects++) {
        if (!valid(url)) return reply('Feed host denied', 403);
        let upstream; try { upstream = await fetch(url, { headers, redirect: 'manual', signal }); } catch { return sourceFailure(url); }
        if ([301, 302, 303, 307, 308].includes(upstream.status)) { await upstream.body?.cancel(); url = new URL(upstream.headers.get('Location') || '', url); continue; }
        const output = new Headers(cors); for (const key of ['content-type', 'etag', 'last-modified']) if (upstream.headers.has(key)) output.set(key, upstream.headers.get(key));
        output.set('X-Brew-Relay', 'upstream'); output.set('X-Brew-Feed-URL', url.href); let body; try { body = [204, 205, 304].includes(upstream.status) ? null : await read(upstream.body, 10485760); } catch { return sourceFailure(url); } return new Response(body, { status: upstream.status, headers: output });
      }
      return sourceFailure(url);
    } catch { return reply('Relay request failed or exceeded limits', 502); }
} };
