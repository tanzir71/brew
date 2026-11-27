import { afterAll, beforeAll, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';
import { safeRegexMany } from '../node/src/services/safe-regex.js';

const harness = createTestHarness({
  workers: [
    {
      config: {
        name: 'brew-regex-test',
        main: fileURLToPath(new URL('./test/regex-probe.ts', import.meta.url)),
        compatibility_date: '2026-07-01',
        compatibility_flags: ['nodejs_compat'],
        rules: [{ type: 'CompiledWasm', globs: ['**/*.wasm', '**/wasm'], fallthrough: true }],
      },
    },
  ],
});
const worker = harness.getWorker('brew-regex-test');
interface Result {
  matches: boolean[];
  timedOut: boolean;
  error?: string;
}
async function run(
  pattern: string,
  values: string[],
  options: { timeout?: number; frozen?: boolean; single?: boolean } = {},
): Promise<Result> {
  const response = await worker.fetch('https://brew.example.test/regex', {
    method: 'POST',
    body: JSON.stringify({ pattern, values, ...options }),
    headers: { 'content-type': 'application/json' },
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json() as Promise<Result>;
}
beforeAll(async () => {
  await harness.listen();
  // Include real lazy WASM initialization in setup, before the matching deadlines.
  expect(await run('ready', ['READY'])).toEqual({ matches: [true], timedOut: false });
}, 30000);
afterAll(() => harness.close());
const values = [
  '',
  'a',
  'aa',
  'ab',
  'abab',
  'Hello WORLDworld',
  'unread',
  'read',
  'a\nb',
  'a\n',
  'Story 123',
  'Greek Ελληνικά',
  'Ω',
  '🙂',
  'é',
  'e\u0301',
  'ß',
  'ſ',
  'K',
  'Kelvin',
  'A\0B',
  String.fromCharCode(0xd800),
  'a.b[0]',
  'globalThis.__brewRegexEscape=1;',
];
const patterns = [
  '^a+$',
  '(a|ab)\\1',
  '(?<=hello )(?<word>world)\\k<word>',
  '(?<!un)read',
  '(?<=([ab]+)([bc]+))$',
  '\\p{Script=Greek}+',
  '\\p{Letter}+',
  '\\u{1F642}',
  '^.$',
  '^a$',
  '^\\w+$',
  '[\\s\\S]*',
  '^a\\x00b$',
  '^é$',
  '^a\\.b\\[0\\]$',
  '(?:a|b)*?',
  '^' + String.fromCharCode(0xd800) + '$',
  'globalThis.__brewRegexEscape=1;',
];
it.each(patterns)('preserves Node iu matching for %j', async (pattern) => {
  const expected = await safeRegexMany(pattern, values);
  expect(expected.error).toBeUndefined();
  expect(expected.timedOut).toBe(false);
  expect(expected.matches.some(Boolean)).toBe(true);
  expect(await run(pattern, values)).toEqual(expected);
});
it('returns a controlled syntax error and preserves single-value semantics', async () => {
  for (const pattern of ['[', '(?<x>a)\\k<missing>', '(?='])
    expect(await run(pattern, ['secret-private-marker'])).toEqual({
      matches: [],
      timedOut: false,
      error: 'Invalid regular expression.',
    });
  expect(await run('ok', ['OK'], { single: true })).toEqual({ matched: true, timedOut: false });
  expect(await run('ok', ['other'], { single: true })).toEqual({ matched: false, timedOut: false });
  expect(await run('[', ['secret'], { single: true })).toEqual({
    matched: false,
    timedOut: false,
    error: 'Invalid regular expression.',
  });
});
it.each(['^(a+)+$', '^(a|aa)+$', '^(a*)*$'])(
  'interrupts %s even when deployed time is frozen and remains usable',
  async (pattern) => {
    const start = performance.now();
    expect(await run(pattern, ['a'.repeat(100000) + '!'], { frozen: true, timeout: 20 })).toEqual({
      matches: [],
      timedOut: true,
      error: 'Regular expression timed out.',
    });
    expect(performance.now() - start).toBeLessThan(1000);
    expect(await run('ok', ['OK'])).toEqual({ matches: [true], timedOut: false });
  },
);
it('has finite fuel at the default deadline with frozen time and discards earlier chunk matches', async () => {
  const start = performance.now();
  expect(
    await run('^(?:ok|(?:a+)+)$', [...Array<string>(300).fill('ok'), 'a'.repeat(100000) + '!'], {
      frozen: true,
    }),
  ).toEqual({ matches: [], timedOut: true, error: 'Regular expression timed out.' });
  expect(performance.now() - start).toBeLessThan(2000);
  expect(await run('a', ['a'], { timeout: 0 })).toEqual({
    matches: [],
    timedOut: true,
    error: 'Regular expression timed out.',
  });
});
it('preserves all 50000 ordered results across chunks without partial success or silent truncation', async () => {
  const batch = Array.from({ length: 50000 }, (_, index) => `Story ${index}`);
  const pattern = '(?<=Story )\\d*[02468]$';
  const expected = await safeRegexMany(pattern, batch);
  expect(expected.error).toBeUndefined();
  expect(expected.timedOut).toBe(false);
  expect(expected.matches.some(Boolean)).toBe(true);
  expect(await run(pattern, batch, { frozen: true })).toEqual(expected);
});
it('bounds compilation and input resources with a redacted failure and recovers for the next call', async () => {
  for (const [pattern, inputs] of [
    ['a'.repeat(4001), ['secret-private-marker']],
    ['a', ['a'.repeat(4 * 1024 * 1024 + 1)]],
    ['a', Array<string>(50001).fill('a')],
    ['a', Array<string>(17).fill('a'.repeat(1024 * 1024))],
  ] as Array<[string, string[]]>) {
    expect(await run(pattern, inputs)).toEqual({
      matches: [],
      timedOut: false,
      error: 'Regular expression exceeded this instance’s execution limits.',
    });
  }
  expect(await run('ok', ['OK'])).toEqual({ matches: [true], timedOut: false });
});
it('isolates concurrent calls and releases failed runtimes without leaking values or matching state', async () => {
  const results = await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      run(index % 3 === 0 ? '[' : `^${index}$`, [String(index)]),
    ),
  );
  results.forEach((result, index) =>
    expect(result).toEqual(
      index % 3 === 0
        ? { matches: [], timedOut: false, error: 'Invalid regular expression.' }
        : { matches: [true], timedOut: false },
    ),
  );
  expect(await run('^never$', ['previous-private-data'])).toEqual({
    matches: [false],
    timedOut: false,
  });
});
