import {
  createLocalJWKSet,
  decodeProtectedHeader,
  errors,
  jwtVerify,
  type JSONWebKeySet,
  type LocalJWKSet,
} from 'jose';

export class AccessUnavailable extends Error {}
export class AccessDenied extends Error {}
export interface AccessConfiguration {
  issuer: string;
  audience: string;
}
export function accessConfiguration(
  team: string | undefined,
  audience: string | undefined,
): AccessConfiguration {
  try {
    const issuer = new URL(team ?? '');
    if (
      issuer.protocol !== 'https:' ||
      issuer.username ||
      issuer.password ||
      issuer.port ||
      issuer.pathname !== '/' ||
      issuer.search ||
      issuer.hash ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(issuer.hostname) ||
      !audience ||
      audience.trim() !== audience ||
      audience.length > 512
    )
      throw new Error();
    return { issuer: issuer.origin, audience };
  } catch {
    throw new AccessUnavailable(
      'Configure the Cloudflare Access team URL and application audience.',
    );
  }
}
type CachedKeys = {
  resolver?: LocalJWKSet;
  expires: number;
  attempted?: number;
  pending?: Promise<void>;
};
/** Cache public keys only; never retain an invocation's fetcher, budget or JWT. */
export class CloudflareAccessVerifier {
  private readonly issuers = new Map<string, CachedKeys>();
  private async refresh(
    config: AccessConfiguration,
    entry: CachedKeys,
    fetcher: typeof fetch,
    now: number,
  ) {
    if (entry.pending) return entry.pending;
    if (entry.attempted !== undefined && now - entry.attempted < 30_000) {
      if (!entry.resolver || entry.expires <= now)
        throw new AccessUnavailable('Access signing keys are temporarily unavailable.');
      return;
    }
    entry.attempted = now;
    const pending = (async () => {
      try {
        const response = await fetcher(`${config.issuer}/cdn-cgi/access/certs`, {
          redirect: 'error',
          signal: AbortSignal.timeout(5_000),
          headers: { accept: 'application/json' },
        });
        if (!response.ok || Number(response.headers.get('content-length')) > 65536) {
          await response.body?.cancel();
          throw new Error();
        }
        if (!response.body) throw new Error();
        const reader = response.body.getReader(),
          chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const value = await reader.read();
            if (value.done) break;
            size += value.value.byteLength;
            if (size > 65536) {
              await reader.cancel();
              throw new Error();
            }
            chunks.push(value.value);
          }
        } finally {
          reader.releaseLock();
        }
        const bytes = new Uint8Array(size);
        let cursor = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, cursor);
          cursor += chunk.byteLength;
        }
        const jwks = JSON.parse(new TextDecoder().decode(bytes)) as JSONWebKeySet;
        if (
          !Array.isArray(jwks.keys) ||
          !jwks.keys.length ||
          jwks.keys.length > 20 ||
          jwks.keys.some((key) => !key || typeof key !== 'object' || 'd' in key)
        )
          throw new Error();
        entry.resolver = createLocalJWKSet(jwks);
        entry.expires = now + 600_000;
      } catch {
        throw new AccessUnavailable('Access signing keys are temporarily unavailable.');
      }
    })();
    entry.pending = pending;
    try {
      await pending;
    } finally {
      if (entry.pending === pending) entry.pending = undefined;
    }
  }
  async verify(
    token: string | null,
    config: AccessConfiguration,
    fetcher: typeof fetch,
    at = new Date(),
  ) {
    if (
      !token ||
      token.length > 16384 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
    )
      throw new AccessDenied('Use a valid Cloudflare Access application token.');
    try {
      const header = decodeProtectedHeader(token);
      if (
        header.alg !== 'RS256' ||
        typeof header.kid !== 'string' ||
        !header.kid ||
        header.kid.length > 256 ||
        header.crit !== undefined ||
        header.b64 !== undefined
      )
        throw new Error();
    } catch {
      throw new AccessDenied('Use a valid Cloudflare Access application token.');
    }
    let entry = this.issuers.get(config.issuer);
    if (!entry) {
      if (this.issuers.size >= 4) this.issuers.delete(this.issuers.keys().next().value!);
      entry = { expires: 0 };
      this.issuers.set(config.issuer, entry);
    }
    if (!entry.resolver || entry.expires <= at.getTime())
      await this.refresh(config, entry, fetcher, at.getTime());
    const verify = () =>
      jwtVerify(token, entry!.resolver!, {
        algorithms: ['RS256'],
        issuer: config.issuer,
        audience: config.audience,
        requiredClaims: ['exp', 'iss', 'aud'],
        currentDate: at,
        clockTolerance: 0,
      });
    try {
      let result;
      try {
        result = await verify();
      } catch (error) {
        if (!(error instanceof errors.JWKSNoMatchingKey)) throw error;
        await this.refresh(config, entry, fetcher, at.getTime());
        result = await verify();
      }
      if (
        result.payload.iat !== undefined &&
        (typeof result.payload.iat !== 'number' || result.payload.iat > at.getTime() / 1000)
      )
        throw new Error();
    } catch (error) {
      if (error instanceof AccessUnavailable) throw error;
      throw new AccessDenied('Use a valid Cloudflare Access application token.');
    }
  }
}
