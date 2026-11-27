import { expect, it } from 'vitest';
import { CloudflareFetchBudget, FetchBudgetExceeded } from './src/fetch-budget.js';
import { MAX_FEED_BYTES, readFeedBody } from './src/feed-parser.js';
import { Miniflare, Response as BindingResponse } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';

it('shares a strict allowance across concurrent callers, including failed attempts', async () => {
  let calls = 0;
  const budget = new CloudflareFetchBudget(40, async () => {
    calls++;
    throw new Error('private upstream URL');
  });
  const results = await Promise.allSettled(
    Array.from({ length: 65 }, () => budget.fetch('https://source.test/feed')),
  );
  expect(calls).toBe(40);
  expect(budget.used).toBe(40);
  expect(budget.remaining).toBe(0);
  expect(
    results.filter(
      (result) => result.status === 'rejected' && result.reason instanceof FetchBudgetExceeded,
    ),
  ).toHaveLength(25);
  for (const result of results)
    if (result.status === 'rejected') expect(result.reason.message).not.toContain('private');
});

it('uses native global fetch with the default transport and standard error redirect policy inside workerd', async () => {
  const root = new URL('../../', import.meta.url);
  const sources = [
    'targets/cloudflare/src/fetch-budget',
    'packages/core/src/feed-polling',
    'packages/core/src/polling',
  ];
  const modules = await Promise.all(
    sources.map(async (name) => ({
      type: 'ESModule' as const,
      path: fileURLToPath(new URL(`${name}.js`, root)),
      contents: transpileModule(await readFile(new URL(`${name}.ts`, root), 'utf8'), {
        compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext },
      }).outputText,
    })),
  );
  let calls = 0;
  const runtime = new Miniflare({
    modulesRoot: fileURLToPath(root),
    compatibilityDate: '2026-07-01',
    modules: [
      {
        type: 'ESModule',
        path: fileURLToPath(new URL('native-fetch-entry.js', root)),
        contents: `
      import { CloudflareFetchBudget } from './targets/cloudflare/src/fetch-budget.js';
      export default { async fetch() {
        const budget = new CloudflareFetchBudget(1);
        const response = await budget.fetch('https://upstream.example.test/', { redirect: 'error' });
        return Response.json({ body: await response.text(), used: budget.used });
      } };`,
      },
      ...modules,
    ],
    outboundService: async () => {
      calls++;
      return new BindingResponse('native-global-fetch-ok');
    },
  });
  try {
    const response = await runtime.dispatchFetch('https://brew.example.test/');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ body: 'native-global-fetch-ok', used: 1 });
    expect(calls).toBe(1);
  } finally {
    await runtime.dispose();
  }
});

it('counts every redirect, cancels discarded bodies, preserves same-origin auth and strips cross-origin credentials', async () => {
  const requests: Request[] = [];
  let cancellations = 0;
  const budget = new CloudflareFetchBudget(3, async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    if (requests.length === 3) return new Response('done');
    return new Response(
      new ReadableStream({
        cancel() {
          cancellations++;
        },
      }),
      {
        status: 302,
        headers: { location: requests.length === 1 ? '/second' : 'https://other.test/third' },
      },
    );
  });
  expect(
    await (
      await budget.fetch('https://source.test/first', {
        headers: {
          authorization: 'Bearer private',
          cookie: 'private',
          'cf-access-client-secret': 'private',
          accept: 'application/xml',
        },
      })
    ).text(),
  ).toBe('done');
  expect(requests.map((request) => request.redirect)).toEqual(['manual', 'manual', 'manual']);
  expect(requests[1]!.headers.get('authorization')).toBe('Bearer private');
  for (const name of ['authorization', 'cookie', 'cf-access-client-secret'])
    expect(requests[2]!.headers.has(name)).toBe(false);
  expect(requests[2]!.headers.get('accept')).toBe('application/xml');
  expect(cancellations).toBe(2);
  expect(budget.used).toBe(3);
});

it('stops a redirect chain before a further fetch and cancels its final body', async () => {
  let calls = 0,
    cancellations = 0;
  const budget = new CloudflareFetchBudget(2, async () => {
    calls++;
    return new Response(
      new ReadableStream({
        cancel() {
          cancellations++;
        },
      }),
      { status: 307, headers: { location: '/again' } },
    );
  });
  await expect(budget.fetch('https://source.test/loop')).rejects.toBeInstanceOf(
    FetchBudgetExceeded,
  );
  expect([calls, cancellations]).toEqual([2, 2]);
});

it('honors manual/error modes and refuses replay of a redirected streaming write', async () => {
  let cancellations = 0;
  const budget = new CloudflareFetchBudget(
    4,
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancellations++;
          },
        }),
        { status: 302, headers: { location: '/other' } },
      ),
  );
  const manual = await budget.fetch('https://source.test/webhook', {
    method: 'POST',
    body: 'private',
    redirect: 'manual',
  });
  expect(manual.status).toBe(302);
  expect(cancellations).toBe(0);
  await manual.body!.cancel();
  await expect(budget.fetch('https://source.test/feed', { redirect: 'error' })).rejects.toThrow(
    'redirected',
  );
  await expect(
    budget.fetch('https://source.test/webhook', { method: 'POST', body: 'private' }),
  ).rejects.toThrow('GET or HEAD');
  expect([budget.used, cancellations]).toEqual([3, 3]);
});

it('rejects redirect responses in error mode even when the response has no Location header', async () => {
  let cancellations = 0;
  const budget = new CloudflareFetchBudget(
    1,
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancellations++;
          },
        }),
        { status: 302 },
      ),
  );
  await expect(budget.fetch('https://source.test/redirect', { redirect: 'error' })).rejects.toThrow(
    'redirected',
  );
  expect(budget.used).toBe(1);
  expect(cancellations).toBe(1);
});

it('validates budgets and destinations, bounds redirect loops and shares body cancellation', async () => {
  for (const value of [0, -1, 41, 1.5, NaN, Infinity])
    expect(() => new CloudflareFetchBudget(value)).toThrow('1 to 40');
  const budget = new CloudflareFetchBudget(
    40,
    async () => new Response(null, { status: 301, headers: { location: '/loop' } }),
  );
  await expect(budget.fetch('https://source.test/loop')).rejects.toThrow('too many times');
  expect(budget.used).toBe(11);
  await expect(budget.fetch('ftp://source.test/feed')).rejects.toThrow('HTTP(S)');
  await expect(budget.fetch('https://user:private-password@source.test/feed')).rejects.not.toThrow(
    'private-password',
  );
  await expect(budget.fetch('not a private-valid URL')).rejects.toThrow('request is invalid');
  expect(budget.used).toBe(11);
});

it('bounds decoded feed bytes even with missing or misleading content length and cancels rejected streams', async () => {
  let cancellations = 0;
  const response = (size: number, length?: string) =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(size));
        },
        cancel() {
          cancellations++;
        },
      }),
      { headers: length ? { 'content-length': length } : {} },
    );
  await expect(readFeedBody(response(1, String(MAX_FEED_BYTES + 1)))).rejects.toThrow('10 MiB');
  await expect(readFeedBody(response(MAX_FEED_BYTES + 1, '1'))).rejects.toThrow('10 MiB');
  expect(cancellations).toBe(2);
  const bytes = new TextEncoder().encode('Brew 漢字');
  const chunks = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 6));
      controller.enqueue(bytes.slice(6));
      controller.close();
    },
  });
  expect(await readFeedBody(new Response(chunks))).toBe('Brew 漢字');
});
