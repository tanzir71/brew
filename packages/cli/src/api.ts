import { DeployError, type DeployState, accessDefinitions } from './model.js';
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
type Row = Record<string, unknown>;
export class CloudflareApi {
  constructor(
    private token: string,
    private fetcher: typeof fetch = globalThis.fetch,
  ) {
    if (!token || token.length > 4096 || /\s/.test(token))
      throw new DeployError('Set CLOUDFLARE_API_TOKEN to a scoped Cloudflare API token.');
  }
  async request(
    path: string,
    method = 'GET',
    body?: unknown,
    missing = false,
  ): Promise<{ result: unknown; result_info?: { total_pages?: number } }> {
    if (!path.startsWith('/') || path.includes('://'))
      throw new DeployError('Invalid Cloudflare API operation.');
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.fetcher(`https://api.cloudflare.com/client/v4${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Brew/0.1',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: controller.signal,
      });
      if (missing && response.status === 404) {
        await response.body?.cancel();
        return { result: null };
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new DeployError(
          `Cloudflare API operation failed (HTTP ${response.status}). Check the token permissions; resources are retained for resume.`,
        );
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty response');
      let text = '',
        bytes = 0;
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.length;
          if (bytes > 2 * 1024 * 1024) throw new Error('Large response');
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const data = JSON.parse(text) as {
        success?: boolean;
        result: unknown;
        result_info?: { total_pages?: number };
      };
      if (data.success !== true) throw new Error('Unacknowledged operation');
      return data;
    } catch (error) {
      if (error instanceof DeployError) throw error;
      throw new DeployError(
        'Cloudflare did not acknowledge an API operation. Rerun with the same deployment directory to resume.',
      );
    } finally {
      clearTimeout(timer);
    }
  }
  async list(path: string): Promise<Row[]> {
    const rows: Row[] = [];
    for (let page = 1; ; page++) {
      const data = await this.request(
        `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
      );
      if (!Array.isArray(data.result))
        throw new DeployError('Cloudflare returned invalid resource metadata.');
      rows.push(...(data.result as Row[]));
      if (!data.result_info?.total_pages || page >= data.result_info.total_pages) return rows;
    }
  }
  async preflight(state: DeployState) {
    const root = `/accounts/${state.inputs.accountId}`;
    const domains = await this.list(`${root}/workers/domains`);
    const host = new URL(state.inputs.origin).hostname,
      domain = domains.find((row) => row.hostname === host);
    if (domain && (!state.workerIntent || domain.service !== state.worker))
      throw new DeployError(
        'That hostname already belongs to another Worker. Choose an unused hostname.',
      );
    let zone: Row | undefined;
    const labels = host.split('.');
    for (let index = 0; index < labels.length - 1 && !zone; index++)
      zone = (
        await this.list(
          `/zones?account.id=${state.inputs.accountId}&name=${encodeURIComponent(labels.slice(index).join('.'))}`,
        )
      ).find((row) => row.name === labels.slice(index).join('.'));
    if (
      !zone ||
      zone.status !== 'active' ||
      typeof zone.id !== 'string' ||
      !/^[a-f\d]{32}$/i.test(zone.id)
    )
      throw new DeployError(
        'The hostname must belong to an active DNS zone in this Cloudflare account.',
      );
    const records = await this.list(
      `/zones/${zone.id}/dns_records?name=${encodeURIComponent(host)}`,
    );
    if (records.length && !domain)
      throw new DeployError(
        'That hostname already has DNS records. Choose an unused hostname; Brew will not replace them.',
      );
    const service = await this.request(
      `${root}/workers/services/${state.worker}`,
      'GET',
      undefined,
      true,
    );
    if (service.result && !state.workerIntent)
      throw new DeployError('That Worker name already exists. Use a new deployment directory.');
    if (!service.result && state.workerIntent) delete state.deployed;
    {
      const org = (await this.request(`${root}/access/organizations`)).result as Row;
      if (
        typeof org?.auth_domain !== 'string' ||
        !/^[a-z\d-]+\.cloudflareaccess\.com$/i.test(org.auth_domain)
      )
        throw new DeployError('Set up a Cloudflare Zero Trust organization before deploying Brew.');
      if (state.inputs.teamDomain && state.inputs.teamDomain !== org.auth_domain)
        throw new DeployError(
          'The team domain does not match this account’s Zero Trust organization.',
        );
      state.inputs.teamDomain = org.auth_domain;
      if (!(await this.list(`${root}/access/identity_providers`)).length)
        throw new DeployError(
          'Configure a Zero Trust sign-in provider, such as One-time PIN, before deploying Brew.',
        );
    }
  }
  async access(state: DeployState, save: () => Promise<void>) {
    const root = `/accounts/${state.inputs.accountId}/access/apps`;
    const existing = await this.list(root);
    const definitions = accessDefinitions(state),
      names = new Set(definitions.map((item) => item.name));
    const host = new URL(state.inputs.origin).hostname;
    for (const app of existing) {
      const candidates = [
        app.domain,
        ...(Array.isArray(app.self_hosted_domains) ? app.self_hosted_domains : []),
        ...(Array.isArray(app.destinations) ? app.destinations.map((item: Row) => item.uri) : []),
      ];
      for (const candidate of candidates)
        if (typeof candidate === 'string') {
          const pattern = candidate.replace(/^https?:\/\//, '').split('/')[0]!;
          const expression = new RegExp(
            '^' +
              pattern
                .split('*')
                .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                .join('[^.]*') +
              '$',
            'i',
          );
          if (expression.test(host) && !names.has(String(app.name)))
            throw new DeployError(
              'An unrelated Access application already covers this hostname. Brew will not change its policy boundary.',
            );
        }
    }
    for (const definition of definitions) {
      let row: Row;
      const known = state.apps[definition.key];
      if (known) row = (await this.request(`${root}/${known.id}`)).result as Row;
      else {
        const matches = existing.filter((app) => app.domain === definition.domain);
        if (matches.some((app) => app.name !== definition.name) || matches.length > 1)
          throw new DeployError(
            'An Access application already protects this hostname or path. Brew will not replace it.',
          );
        if (matches.length && !state.intents[definition.key])
          throw new DeployError(
            'An Access resource exists without a matching creation intent. Choose a new directory.',
          );
        if (matches[0]) row = matches[0];
        else {
          state.intents[definition.key] = true;
          await save();
          row = (
            await this.request(root, 'POST', {
              name: definition.name,
              domain: definition.domain,
              type: 'self_hosted',
              session_duration: '24h',
              app_launcher_visible: definition.key === 'owner',
              http_only_cookie_attribute: true,
            })
          ).result as Row;
        }
      }
      if (
        !uuid(row?.id) ||
        row.domain !== definition.domain ||
        row.type !== 'self_hosted' ||
        row.name !== definition.name ||
        (known && (row.id !== known.id || row.aud !== known.aud)) ||
        (Array.isArray(row.self_hosted_domains) &&
          row.self_hosted_domains.some((value) => value !== definition.domain)) ||
        (Array.isArray(row.destinations) &&
          row.destinations.some((value: Row) => value.uri !== definition.domain)) ||
        typeof row.aud !== 'string' ||
        !/^[a-z\d_-]{16,256}$/i.test(row.aud)
      )
        throw new DeployError('Access application metadata does not match this deployment.');
      state.apps[definition.key] = { id: row.id, aud: row.aud, domain: definition.domain };
      await save();
      let policies = await this.list(`${root}/${row.id}/policies`);
      if (!policies.length) {
        await this.request(`${root}/${row.id}/policies`, 'POST', definition.policy);
        policies = await this.list(`${root}/${row.id}/policies`);
      }
      if (
        policies.length !== 1 ||
        policies[0]!.decision !== definition.policy.decision ||
        JSON.stringify(policies[0]!.include) !== JSON.stringify(definition.policy.include) ||
        ((policies[0]!.exclude as unknown[])?.length ?? 0) ||
        ((policies[0]!.require as unknown[])?.length ?? 0)
      )
        throw new DeployError(
          'Access policies have changed. Review them before resuming; Brew will not overwrite them.',
        );
    }
  }
  async storage(state: DeployState, save: () => Promise<void>) {
    const root = `/accounts/${state.inputs.accountId}`;
    let database: Row;
    if (state.databaseId)
      database = (await this.request(`${root}/d1/database/${state.databaseId}`)).result as Row;
    else {
      const existing = (
        await this.list(`${root}/d1/database?name=${encodeURIComponent(state.databaseName)}`)
      ).find((row) => row.name === state.databaseName);
      if (existing && !state.intents.database)
        throw new DeployError('A D1 database already uses this name. Brew will not adopt it.');
      state.intents.database = true;
      await save();
      database =
        existing ??
        ((await this.request(`${root}/d1/database`, 'POST', { name: state.databaseName }))
          .result as Row);
    }
    if (database?.name !== state.databaseName || !uuid(database.uuid))
      throw new DeployError('D1 metadata does not match this deployment.');
    state.databaseId = database.uuid;
    await save();
    let bucket = (await this.request(`${root}/r2/buckets/${state.bucket}`, 'GET', undefined, true))
      .result as Row | null;
    if (bucket && !state.intents.bucket)
      throw new DeployError('An R2 bucket already uses this name. Brew will not adopt it.');
    if (!bucket) {
      state.intents.bucket = true;
      await save();
      bucket = (await this.request(`${root}/r2/buckets`, 'POST', { name: state.bucket }))
        .result as Row;
    }
    if (bucket?.name !== state.bucket)
      throw new DeployError('R2 metadata does not match this deployment.');
    await save();
  }
}
