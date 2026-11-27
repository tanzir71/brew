import { PollInterruptedError } from '../../../packages/core/src/feed-polling.js';

export const MAX_FETCH_REDIRECTS = 10;
function validateDestination(url: URL) {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Only HTTP(S) fetch destinations without embedded credentials are supported.');
}

export class FetchBudgetExceeded extends PollInterruptedError {
  constructor() {
    super('This invocation has used its fetch allowance. Polling will resume on the next run.');
  }
}
/** One instance per invocation, shared by polling, rules and delivery. */
export class CloudflareFetchBudget {
  private count = 0;
  constructor(
    readonly limit = 40,
    private readonly upstream: typeof fetch = globalThis.fetch,
  ) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 40)
      throw new Error('The Cloudflare fetch allowance must be an integer from 1 to 40.');
  }
  get used() {
    return this.count;
  }
  get remaining() {
    return this.limit - this.count;
  }
  readonly fetch: typeof fetch = async (input, init) => {
    let request: Request;
    try {
      request = new Request(input, init);
    } catch {
      throw new Error('The fetch request is invalid.');
    }
    const mode = request.redirect;
    for (let redirects = 0; ; redirects++) {
      const url = new URL(request.url);
      validateDestination(url);
      if (!this.remaining) throw new FetchBudgetExceeded();
      this.count++;
      let response: Response;
      try {
        response = await this.upstream(new Request(request, { redirect: 'manual' }));
      } catch {
        throw new Error('The upstream request failed.');
      }
      const location = response.headers.get('location');
      if (![301, 302, 303, 307, 308].includes(response.status) || !location || mode === 'manual')
        return response;
      await response.body?.cancel();
      if (mode === 'error') throw new Error('The upstream request redirected.');
      if (redirects >= MAX_FETCH_REDIRECTS)
        throw new Error('The upstream request redirected too many times.');
      // All product webhook/delivery POSTs use manual redirects. Do not replay an
      // arbitrary streaming body or leak its credentials to a redirected host.
      if (!['GET', 'HEAD'].includes(request.method))
        throw new Error('Automatic redirects require a GET or HEAD request.');
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        throw new Error('The upstream redirect destination is invalid.');
      }
      validateDestination(next);
      const headers = new Headers(request.headers);
      headers.delete('host');
      if (next.origin !== url.origin)
        for (const name of [
          'authorization',
          'cookie',
          'proxy-authorization',
          'cf-access-jwt-assertion',
          'cf-access-client-id',
          'cf-access-client-secret',
        ])
          headers.delete(name);
      request = new Request(next, {
        method: request.method,
        headers,
        signal: request.signal,
        redirect: mode,
      });
    }
  };
}
