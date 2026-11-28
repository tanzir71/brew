import { PollInterruptedError } from '../../../packages/core/src/feed-polling.js';

export interface RelayConfig {
  endpoint: string;
  token: string;
}
export function relayConfig(value: RelayConfig): RelayConfig {
  const endpoint = new URL(value.endpoint);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if (
    (endpoint.protocol !== 'https:' && !(local && endpoint.protocol === 'http:')) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash ||
    endpoint.search ||
    !/^[\x21-\x7e]{32,4096}$/.test(value.token)
  )
    throw new TypeError(
      'Use an HTTPS relay endpoint and a token of at least 32 printable characters.',
    );
  return { endpoint: endpoint.href, token: value.token };
}

/** Private feed URLs belong in the authenticated request body, never in the relay URL. */
export function relayFetch(config: RelayConfig, lifetime: AbortSignal): typeof fetch {
  return async (input, init) => {
    if (lifetime.aborted) throw new PollInterruptedError('Browser fetching stopped.');
    const headers = new Headers(init?.headers);
    const conditional = Object.fromEntries(
      ['accept', 'if-none-match', 'if-modified-since']
        .filter((key) => headers.has(key))
        .map((key) => [key, headers.get(key)!]),
    );
    let response: Response;
    try {
      response = await fetch(config.endpoint, {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
        body: JSON.stringify({ url: String(input), headers: conditional }),
        signal: AbortSignal.any([lifetime, init?.signal ?? AbortSignal.timeout(20_000)]),
      });
    } catch {
      throw new PollInterruptedError(
        lifetime.aborted
          ? 'Browser fetching stopped.'
          : 'The relay could not be reached. Check its address and CORS configuration.',
      );
    }
    if (response.headers.get('x-brew-relay') !== 'upstream') {
      await response.body?.cancel();
      throw new PollInterruptedError(
        'The relay rejected this request. Check its token, allowed origin and feed hosts.',
      );
    }
    const finalUrl = response.headers.get('x-brew-feed-url');
    if (!finalUrl || !/^https?:\/\//i.test(finalUrl)) {
      await response.body?.cancel();
      throw new PollInterruptedError('The relay returned an invalid response.');
    }
    Object.defineProperty(response, 'url', { value: finalUrl });
    return response;
  };
}
