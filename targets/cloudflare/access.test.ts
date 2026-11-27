import { expect, it } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import {
  accessConfiguration,
  AccessDenied,
  AccessUnavailable,
  CloudflareAccessVerifier,
} from './src/access.js';
import { publicOrigin } from './src/worker-config.js';

const config = accessConfiguration('https://brew-test.cloudflareaccess.com', 'owner-app');
const at = Date.parse('2026-11-27T12:00:00Z');
const first = await generateKeyPair('RS256', { extractable: true });
const second = await generateKeyPair('RS256', { extractable: true });
const jwks = async (pair: typeof first, kid: string) => ({
  keys: [{ ...(await exportJWK(pair.publicKey)), kid, alg: 'RS256', use: 'sig' }],
});
const jwt = (pair = first, kid = 'first', claims: Record<string, unknown> = {}) =>
  new SignJWT({ iss: config.issuer, aud: config.audience, exp: at / 1000 + 3600, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid })
    .sign(pair.privateKey);

it('deduplicates concurrent key loads and caches only public verification state across different invocation fetchers', async () => {
  const verifier = new CloudflareAccessVerifier(),
    keys = await jwks(first, 'first'),
    signed = await jwt();
  let requests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    requests++;
    expect(String(input)).toBe(`${config.issuer}/cdn-cgi/access/certs`);
    expect(init?.redirect).toBe('error');
    await new Promise((resolve) => setTimeout(resolve, 10));
    return Response.json(keys);
  };
  await Promise.all(
    Array.from({ length: 8 }, () => verifier.verify(signed, config, fetcher, new Date(at))),
  );
  expect(requests).toBe(1);
  await verifier.verify(
    signed,
    config,
    async () => {
      throw new Error('Old invocation must not be reused.');
    },
    new Date(at + 1),
  );
});

it('refreshes rotated keys after the cooldown, refuses unknown keys without a fetch storm and fails closed after expiry', async () => {
  const verifier = new CloudflareAccessVerifier(),
    old = await jwt(),
    rotated = await jwt(second, 'second');
  let keys = await jwks(first, 'first'),
    calls = 0,
    status = 200;
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json(keys, { status });
  };
  await verifier.verify(old, config, fetcher, new Date(at));
  keys = await jwks(second, 'second');
  for (let index = 0; index < 8; index++)
    await expect(
      verifier.verify(rotated, config, fetcher, new Date(at + 1)),
    ).rejects.toBeInstanceOf(AccessDenied);
  expect(calls).toBe(1);
  await verifier.verify(rotated, config, fetcher, new Date(at + 30_001));
  expect(calls).toBe(2);
  status = 503;
  await expect(
    verifier.verify(rotated, config, fetcher, new Date(at + 631_000)),
  ).rejects.toBeInstanceOf(AccessUnavailable);
  await expect(
    verifier.verify(rotated, config, fetcher, new Date(at + 631_001)),
  ).rejects.toBeInstanceOf(AccessUnavailable);
  expect(calls).toBe(3);
  status = 200;
  await verifier.verify(rotated, config, fetcher, new Date(at + 662_000));
  expect(calls).toBe(4);
});

it('does not follow token-controlled key URLs or accept HMAC/unsigned assertions', async () => {
  const verifier = new CloudflareAccessVerifier();
  let calls = 0;
  const signed = await new SignJWT({
    iss: config.issuer,
    aud: config.audience,
    exp: at / 1000 + 3600,
  })
    .setProtectedHeader({ alg: 'HS256', kid: 'first', jku: 'https://attacker.test/keys' })
    .sign(new TextEncoder().encode('private-test-key-not-the-rsa-public-key'));
  await expect(
    verifier.verify(
      signed,
      config,
      async () => {
        calls++;
        return Response.json({ keys: [] });
      },
      new Date(at),
    ),
  ).rejects.toBeInstanceOf(AccessDenied);
  expect(calls).toBe(0);
  const keys = await jwks(first, 'first');
  const rsa = await new SignJWT({
    iss: config.issuer,
    aud: [config.audience, 'other'],
    exp: at / 1000 + 3600,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'first', jku: 'https://attacker.test/keys' })
    .sign(first.privateKey);
  await verifier.verify(
    rsa,
    config,
    async (input) => {
      expect(String(input)).toBe(`${config.issuer}/cdn-cgi/access/certs`);
      calls++;
      return Response.json(keys);
    },
    new Date(at),
  );
  expect(calls).toBe(1);
});

it('bounds key responses and cancels oversized streams before accepting any public key', async () => {
  const signed = await jwt();
  let cancelled = 0;
  const verifier = new CloudflareAccessVerifier();
  await expect(
    verifier.verify(
      signed,
      config,
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(65537));
            },
            cancel() {
              cancelled++;
            },
          }),
        ),
      new Date(at),
    ),
  ).rejects.toBeInstanceOf(AccessUnavailable);
  expect(cancelled).toBe(1);
  await expect(
    new CloudflareAccessVerifier().verify(
      signed,
      config,
      async () => Response.json({ keys: Array.from({ length: 21 }, () => ({})) }),
      new Date(at),
    ),
  ).rejects.toBeInstanceOf(AccessUnavailable);
  const key = (await jwks(first, 'first')).keys[0]!;
  await expect(
    new CloudflareAccessVerifier().verify(
      signed,
      config,
      async () => Response.json({ keys: [{ ...key, d: 'private-key-material' }] }),
      new Date(at),
    ),
  ).rejects.toBeInstanceOf(AccessUnavailable);
});

it('throttles a failed initial JWKS request without trusting a stale resolver or retaining response details', async () => {
  const verifier = new CloudflareAccessVerifier(),
    signed = await jwt();
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    throw new Error('private provider diagnostic');
  };
  for (let index = 0; index < 5; index++) {
    try {
      await verifier.verify(signed, config, fetcher, new Date(at + index));
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(AccessUnavailable);
      expect((error as Error).message).not.toContain('private');
    }
  }
  expect(calls).toBe(1);
});

it('validates trusted Access/public configuration without deriving an issuer from untrusted JWT data', () => {
  for (const team of [
    undefined,
    'http://brew-test.cloudflareaccess.com',
    'https://attacker.test',
    'https://brew-test.cloudflareaccess.com.attacker.test',
    'https://user:private@brew-test.cloudflareaccess.com',
    'https://brew-test.cloudflareaccess.com/other',
    'https://brew-test.cloudflareaccess.com?keys=attacker',
    'https://brew-test.cloudflareaccess.com:8443',
  ])
    expect(() => accessConfiguration(team, 'owner-app')).toThrow(AccessUnavailable);
  for (const audience of [undefined, '', ' owner-app'])
    expect(() => accessConfiguration(config.issuer, audience)).toThrow(AccessUnavailable);
  for (const origin of [
    undefined,
    'http://brew.test',
    'https://brew.test/path',
    'https://user:private@brew.test',
    'https://brew.test?token=private',
  ])
    expect(() => publicOrigin(origin)).toThrow('HTTPS origin');
  expect(publicOrigin('https://brew.example.test/')).toBe('https://brew.example.test');
});
