import type { ApiServices } from '../../../packages/api/src/ports.js';
import type { AgentConnection } from '../../../packages/core/src/agent-access.js';
import { ActionError } from '../../../packages/core/src/actions.js';
import {
  agentTokenEntry,
  agentTokenInput,
  agentConnection,
  agentBearerSecret,
  agentActivityResult,
  agentActivityPage,
  type AgentTokenRow,
  type AgentActivityRow,
} from '../../../packages/core/src/agent-access-policy.js';
import {
  listAgentTokens,
  insertAgentToken,
  authenticateAgentToken,
  currentAgentToken,
  insertAgentActivity,
  listAgentActivity,
} from '../../../packages/db/src/agent-access-queries.js';
import type { CloudflareActionStorage } from './action-storage.js';
import { CloudflareStorage } from './storage.js';
import { cloudflareSha256 } from './read-actions.js';

/** Native Worker entropy/hash with the same durable verifier and policy as Node. */
export class CloudflareAgentAccess implements NonNullable<ApiServices['agentAccess']> {
  constructor(
    private storage: CloudflareStorage,
    private actions: Pick<CloudflareActionStorage, 'cleanup' | 'mapReceipt'>,
    private now: () => number = Date.now,
  ) {}
  async list() {
    return (await this.storage.all<AgentTokenRow>(listAgentTokens)).map(agentTokenEntry);
  }
  async create(value: unknown) {
    const input = agentTokenInput(value);
    const random = crypto.getRandomValues(new Uint8Array(32));
    const secret = btoa(String.fromCharCode(...random))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
    const token = `brew_${input.scopes === 'write' ? 'rw' : 'ro'}_${secret}`;
    const hash = await cloudflareSha256(token),
      now = this.now();
    const row = await this.storage.first<AgentTokenRow>(insertAgentToken, [
      input.name,
      hash,
      input.scopes,
      now + input.days * 86400000,
      now,
    ]);
    if (!row) throw new ActionError(409, 'Revoke an old token before creating another.');
    return { token, entry: agentTokenEntry(row) };
  }
  async revoke(id: number) {
    await this.storage.run('DELETE FROM api_tokens WHERE id=?', [id]);
  }
  async authenticate(authorization: string | null) {
    const token = agentBearerSecret(authorization);
    if (!token) return null;
    const hash = await cloudflareSha256(token),
      now = this.now();
    const row = await this.storage.first<AgentTokenRow>(authenticateAgentToken, [now, hash, now]);
    return row ? agentConnection(row) : null;
  }
  async current(tokenId: number) {
    const now = this.now();
    const row = await this.storage.first<AgentTokenRow>(currentAgentToken, [now, tokenId, now]);
    return row ? agentConnection(row) : null;
  }
  async record(connection: AgentConnection, tool: string, outcome: 'complete' | 'failed') {
    await this.storage.run(insertAgentActivity, [
      connection.tokenId ?? null,
      connection.name ?? 'mcp',
      tool,
      '{}',
      agentActivityResult(tool, outcome),
      this.now(),
    ]);
  }
  async activity(before?: number) {
    await this.actions.cleanup();
    const rows = await this.storage.all<AgentActivityRow>(listAgentActivity, [
      before ?? Number.MAX_SAFE_INTEGER,
    ]);
    return agentActivityPage(rows, (row) => this.actions.mapReceipt(row));
  }
}
