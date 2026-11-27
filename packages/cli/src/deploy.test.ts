import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CloudflareApi } from './api.js';
import { deployCloudflare, verifyDeployment } from './deploy.js';
import { atomicWrite, digest, loadState, lockDirectory, payloadManifest } from './files.js';
import { accessDefinitions, newState, validateInputs, type DeployState } from './model.js';
import { parseArgs } from './main.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== tmpdir() || !path.basename(root).startsWith('brew-cli-test-'))
      throw new Error('Unexpected cleanup path');
    await rm(root, { recursive: true, force: true });
  }
});
const inputs = {
  accountId: 'a'.repeat(32),
  origin: 'https://brew.example.net',
  owner: 'owner@example.net',
  prefix: 'brew-reader',
};
type Row = Record<string, unknown>;
class Provider {
  apps: Row[] = [];
  policies = new Map<string, Row[]>();
  databases: Row[] = [];
  bucket: Row | null = null;
  posts: string[] = [];
  calls: string[] = [];
  domains: Row[] = [];
  dns: Row[] = [];
  service = false;
  failure = '';
  idp = true;
  token = 'private-token-never-log';
  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input)),
      method = init?.method ?? 'GET';
    expect(url.origin).toBe('https://api.cloudflare.com');
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${this.token}`);
    expect(init?.redirect).toBe('error');
    this.calls.push(method + ' ' + url.pathname);
    const route = url.pathname
      .replace('/client/v4', '')
      .replace(`/accounts/${inputs.accountId}`, '');
    const body = init?.body ? (JSON.parse(String(init.body)) as Row) : {};
    let result: unknown,
      status = 200;
    if (method === 'POST') this.posts.push(route);
    if (route === '/workers/domains') result = this.domains;
    else if (route.startsWith('/workers/services/')) {
      result = this.service ? {} : null;
      status = this.service ? 200 : 404;
    } else if (route === '/zones')
      result =
        url.searchParams.get('name') === 'example.net'
          ? [{ id: 'b'.repeat(32), name: 'example.net', status: 'active' }]
          : [];
    else if (route.includes('/dns_records')) result = this.dns;
    else if (route === '/access/organizations')
      result = { auth_domain: 'brew-team.cloudflareaccess.com' };
    else if (route === '/access/identity_providers')
      result = this.idp ? [{ id: randomUUID(), type: 'onetimepin' }] : [];
    else if (route === '/access/apps') {
      if (method === 'POST') {
        const app = { ...body, id: randomUUID(), aud: 'c'.repeat(64) };
        this.apps.push(app);
        result = app;
      } else result = this.apps;
    } else if (route.startsWith('/access/apps/')) {
      const id = route.split('/')[3]!;
      if (route.endsWith('/policies')) {
        if (method === 'POST') this.policies.set(id, [{ ...body, id: randomUUID() }]);
        result = this.policies.get(id) ?? [];
      } else result = this.apps.find((app) => app.id === id);
    } else if (route === '/d1/database') {
      if (method === 'POST') {
        const row = { name: body.name, uuid: randomUUID() };
        this.databases.push(row);
        result = row;
      } else result = this.databases.filter((row) => row.name === url.searchParams.get('name'));
    } else if (route.startsWith('/d1/database/'))
      result = this.databases.find((row) => row.uuid === route.split('/').at(-1));
    else if (route === '/r2/buckets' && method === 'POST')
      result = this.bucket = { name: body.name };
    else if (route.startsWith('/r2/buckets/')) {
      result = this.bucket;
      status = result ? 200 : 404;
    } else throw new Error('Unexpected route ' + route);
    if (method === 'POST' && this.failure === route) {
      this.failure = '';
      throw new Error(this.token + ' unknown response');
    }
    return Response.json({ success: status === 200, result }, { status });
  };
  api() {
    return new CloudflareApi(this.token, this.fetch);
  }
}
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'brew-cli-test-'));
  roots.push(root);
  const payload = path.join(root, 'payload'),
    directory = path.join(root, 'instance');
  const bytes: Record<string, string> = {
    'worker/worker.js': 'export default {}',
    'worker/abc-wasm': '\0asm',
    'assets/index.html': '<html></html>',
    'migrations/0001.sql': 'CREATE TABLE test (id TEXT);',
  };
  const files = [];
  for (const [relative, value] of Object.entries(bytes)) {
    const file = path.join(payload, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, value);
    files.push({ path: relative, bytes: Buffer.byteLength(value), sha256: digest(value) });
  }
  await writeFile(
    path.join(payload, 'manifest.json'),
    JSON.stringify({ version: 1, hash: digest(JSON.stringify(files)), files }),
  );
  const provider = new Provider(),
    runs: string[][] = [],
    logs: string[] = [];
  let verifications = 0;
  const ports = {
    api: provider.api(),
    run: async (args: string[]) => {
      runs.push(args);
    },
    verify: async () => {
      verifications++;
    },
    log: (line: string) => logs.push(line),
  };
  return {
    root,
    payload,
    directory,
    provider,
    runs,
    logs,
    ports,
    options: { directory, payload, inputs },
    verifications: () => verifications,
  };
}
describe('Cloudflare installer', () => {
  it('dry run checks the actual payload without credentials, writes or account requests', async () => {
    const f = await fixture();
    const plan = await deployCloudflare({ ...f.options, dryRun: true });
    expect(plan).toMatchObject({ dryRun: true, origin: inputs.origin });
    expect(await readdir(f.root)).toEqual(['payload']);
    expect(f.provider.calls).toEqual([]);
    expect(JSON.stringify(plan)).not.toContain(f.provider.token);
  });
  it('provisions private resources, exact owner/path policies and canonical bindings before migration/upload', async () => {
    const f = await fixture();
    const state = (await deployCloudflare(f.options, f.ports)) as DeployState;
    expect(f.provider.apps).toHaveLength(6);
    for (const definition of accessDefinitions(state)) {
      const app = f.provider.apps.find((app) => app.domain === definition.domain)!;
      expect(f.provider.policies.get(String(app.id))).toMatchObject([definition.policy]);
    }
    expect(f.provider.databases).toHaveLength(1);
    expect(f.provider.bucket?.name).toBe(state.bucket);
    expect(f.runs.map((args) => args.slice(0, 2))).toEqual([
      ['d1', 'migrations'],
      ['deploy', '--config'],
    ]);
    expect(f.runs[0]).toContain('DB');
    expect(f.runs[0]).toContain('--remote');
    const config = JSON.parse(await readFile(path.join(f.directory, 'wrangler.json'), 'utf8'));
    expect(config).toMatchObject({
      workers_dev: false,
      preview_urls: false,
      keep_vars: true,
      d1_databases: [{ database_id: state.databaseId }],
      vars: {
        BREW_ACCESS_AUD: state.apps.owner!.aud,
        BREW_ACCESS_TEAM_DOMAIN: 'https://brew-team.cloudflareaccess.com',
      },
    });
    expect(config.routes).toEqual([{ pattern: 'brew.example.net', custom_domain: true }]);
    expect(state.verified).toBeTruthy();
    expect(f.verifications()).toBe(1);
    expect(await readdir(f.directory)).not.toContain('.deploy.lock');
    expect(await readFile(path.join(f.directory, 'deploy.json'), 'utf8')).not.toContain(
      f.provider.token,
    );
    expect(f.logs.join('\n')).not.toContain(f.provider.token);
    const posts = f.provider.posts.length;
    f.provider.service = true;
    await deployCloudflare(f.options, f.ports);
    expect(f.provider.posts).toHaveLength(posts);
    expect(f.runs).toHaveLength(2);
    expect(f.verifications()).toBe(2);
  });
  it.each(['/access/apps', '/d1/database', '/r2/buckets'])(
    'recovers an unacknowledged %s creation from persisted intent without duplication',
    async (route) => {
      const f = await fixture();
      f.provider.failure = route;
      await expect(deployCloudflare(f.options, f.ports)).rejects.toThrow('not acknowledge');
      expect(f.runs).toEqual([]);
      await deployCloudflare(f.options, f.ports);
      expect(f.provider.apps).toHaveLength(6);
      expect(f.provider.databases).toHaveLength(1);
      expect(f.provider.posts.filter((value) => value === route)).toHaveLength(
        route === '/access/apps' ? 6 : 1,
      );
    },
  );
  it('retains resources after a migration failure, and never uploads that attempt', async () => {
    const f = await fixture();
    await expect(
      deployCloudflare(f.options, {
        ...f.ports,
        run: async () => {
          throw new Error('migration failed');
        },
      }),
    ).rejects.toThrow('migration failed');
    const before = await loadState(f.directory);
    expect(before?.databaseId).toBeTruthy();
    expect(before?.deployed).toBeUndefined();
    await deployCloudflare(f.options, f.ports);
    expect(f.provider.databases).toHaveLength(1);
    expect(f.runs).toHaveLength(2);
  });
  it('upgrades a changed payload using the same private resource identities', async () => {
    const f = await fixture();
    const before = (await deployCloudflare(f.options, f.ports)) as DeployState;
    f.provider.service = true;
    const manifestPath = path.join(f.payload, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const bytes = 'export default { /* next release */ }';
    await writeFile(path.join(f.payload, 'worker/worker.js'), bytes);
    manifest.files[0] = {
      path: 'worker/worker.js',
      bytes: Buffer.byteLength(bytes),
      sha256: digest(bytes),
    };
    manifest.hash = digest(JSON.stringify(manifest.files));
    await writeFile(manifestPath, JSON.stringify(manifest));
    const after = (await deployCloudflare(f.options, f.ports)) as DeployState;
    expect(after.databaseId).toBe(before.databaseId);
    expect(after.bucket).toBe(before.bucket);
    expect(after.apps).toEqual(before.apps);
    expect(after.payload).not.toBe(before.payload);
    expect(f.runs).toHaveLength(4);
    expect(f.provider.databases).toHaveLength(1);
  });
  it('resumes an unacknowledged upload using the same resource identities', async () => {
    const f = await fixture();
    await expect(
      deployCloudflare(f.options, {
        ...f.ports,
        run: async (args) => {
          if (args[0] === 'deploy') throw new Error('unknown upload');
        },
      }),
    ).rejects.toThrow('unknown upload');
    const before = await loadState(f.directory);
    expect(before?.workerIntent).toBe(true);
    f.provider.service = true;
    f.provider.domains = [{ hostname: 'brew.example.net', service: before!.worker }];
    f.provider.dns = [{ name: 'brew.example.net' }];
    const after = (await deployCloudflare(f.options, f.ports)) as DeployState;
    expect(after.databaseId).toBe(before!.databaseId);
    expect(after.worker).toBe(before!.worker);
    expect(f.provider.apps).toHaveLength(6);
  });
  it.each(['dns', 'worker', 'access', 'wildcard', 'idp'])(
    'rejects a conflicting %s boundary without deployment or resource replacement',
    async (kind) => {
      const f = await fixture();
      if (kind === 'dns') f.provider.dns = [{ name: 'brew.example.net' }];
      if (kind === 'worker') f.provider.service = true;
      if (kind === 'access' || kind === 'wildcard')
        f.provider.apps = [
          {
            name: 'Unrelated',
            domain: kind === 'access' ? 'brew.example.net/api' : '*.example.net',
          },
        ];
      if (kind === 'idp') f.provider.idp = false;
      await expect(deployCloudflare(f.options, f.ports)).rejects.toThrow();
      expect(f.runs).toEqual([]);
      expect(f.provider.posts).toEqual([]);
    },
  );
  it.each(['database', 'bucket'])(
    'refuses an unrelated existing %s even with its generated name',
    async (kind) => {
      const f = await fixture(),
        state = newState(inputs);
      await mkdir(f.directory);
      await atomicWrite(path.join(f.directory, 'deploy.json'), state);
      if (kind === 'database')
        f.provider.databases = [{ name: state.databaseName, uuid: randomUUID() }];
      else f.provider.bucket = { name: state.bucket };
      await expect(deployCloudflare(f.options, f.ports)).rejects.toThrow('will not adopt');
      expect(f.runs).toEqual([]);
    },
  );
  it('refuses changed Access policy on resume and does not upload or repair it', async () => {
    const f = await fixture();
    await deployCloudflare(f.options, f.ports);
    const state = (await loadState(f.directory))!;
    f.provider.policies.set(state.apps.owner!.id, [
      { decision: 'bypass', include: [{ everyone: {} }] },
    ]);
    const posts = f.provider.posts.length;
    await expect(deployCloudflare(f.options, f.ports)).rejects.toThrow('policies have changed');
    expect(f.runs).toHaveLength(2);
    expect(f.provider.posts).toHaveLength(posts);
  });
  it.each(['owner', 'origin', 'accountId', 'prefix'])(
    'refuses changed %s settings before any account request',
    async (key) => {
      const f = await fixture();
      await deployCloudflare(f.options, f.ports);
      const calls = f.provider.calls.length;
      await expect(
        deployCloudflare({ ...f.options, inputs: { ...inputs, [key]: 'changed' } }, f.ports),
      ).rejects.toThrow('different deployment settings');
      expect(f.provider.calls).toHaveLength(calls);
    },
  );
  it('refuses unrelated directories, concurrent locks and modified managed configuration', async () => {
    const f = await fixture();
    await mkdir(f.directory);
    await writeFile(path.join(f.directory, 'keep.txt'), 'keep');
    await expect(deployCloudflare(f.options, f.ports)).rejects.toThrow('empty directory');
    await rm(path.join(f.directory, 'keep.txt'));
    const unlock = await lockDirectory(f.directory);
    await expect(deployCloudflare(f.options, f.ports)).rejects.toThrow('Another deployment');
    await unlock();
    await deployCloudflare(f.options, f.ports);
    const file = path.join(f.directory, 'wrangler.json');
    await writeFile(file, '{"user":"change"}');
    const calls = f.provider.calls.length;
    await expect(deployCloudflare(f.options, f.ports)).rejects.toThrow('configuration has changed');
    expect(f.provider.calls).toHaveLength(calls);
    expect(await readFile(file, 'utf8')).toContain('change');
  });
  it('rejects changed package bytes before provisioning', async () => {
    const f = await fixture();
    await writeFile(path.join(f.payload, 'worker/worker.js'), 'changed');
    await expect(payloadManifest(f.payload)).rejects.toThrow('incomplete or changed');
    expect(f.provider.calls).toEqual([]);
  });
  it('redacts provider errors and refuses redirects, malformed and oversized responses', async () => {
    for (const response of [
      new Response('token-secret', { status: 403 }),
      Response.json({ success: false, errors: [{ message: 'token-secret' }] }),
      new Response('x'.repeat(2 * 1024 * 1024 + 1)),
    ]) {
      const api = new CloudflareApi('token-secret', async () => response);
      const error = await api.request('/accounts/example').catch((error) => error as Error);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain('token-secret');
    }
  });
  it('verifies public health and owner denial, rejecting a public owner page or broken health', async () => {
    await verifyDeployment(inputs.origin, async (url) =>
      String(url).endsWith('/api/health')
        ? Response.json({ ok: true })
        : new Response(null, { status: 302 }),
    );
    await expect(
      verifyDeployment(inputs.origin, async () => Response.json({ ok: false })),
    ).rejects.toThrow('health is not ready');
    await expect(
      verifyDeployment(inputs.origin, async () => Response.json({ ok: true })),
    ).rejects.toThrow('owner boundary');
  });
  it('validates origins and rejects token arguments without echoing them', () => {
    for (const origin of [
      'http://brew.example.net',
      'https://a.workers.dev',
      'https://127.0.0.1',
      'https://brew.example.net/path',
      'https://brew.example.net?token=secret',
    ])
      expect(() => validateInputs({ ...inputs, origin })).toThrow();
    expect(() => parseArgs(['deploy', 'cloudflare', '--token', 'private-token'])).toThrow(
      'Invalid',
    );
    expect(parseArgs(['deploy', 'cloudflare', '--dry-run'])).toMatchObject({ dryRun: true });
  });
});
