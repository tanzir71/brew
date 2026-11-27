import { createHash, randomBytes } from 'node:crypto';
import type { BrewDatabase } from '../db/database.js';
import type {
  AgentAccessPort,
  AgentConnection,
} from '../../../../packages/core/src/agent-access.js';
import { ActionError } from '../../../../packages/core/src/actions.js';
import {
  agentTokenEntry,
  agentTokenInput,
  agentConnection,
  agentBearerSecret,
  agentActivityResult,
  agentActivityPage,
  type AgentTokenRow,
  type AgentActivityRow,
} from '../../../../packages/core/src/agent-access-policy.js';
import {
  listAgentTokens,
  insertAgentToken,
  authenticateAgentToken,
  currentAgentToken,
  insertAgentActivity,
  listAgentActivity,
} from '../../../../packages/db/src/agent-access-queries.js';
import type { ClockPort } from '../../../../packages/core/src/ports.js';
import type { NodeActionStorage } from './action-storage.js';
import { nodeClock } from './runtime.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export class NodeAgentAccess implements AgentAccessPort {
  constructor(
    private readonly database: BrewDatabase,
    private readonly actions: NodeActionStorage,
    private readonly clock: Pick<ClockPort, 'now'> = nodeClock,
  ) {}
  list() {
    return (this.database.sqlite.prepare(listAgentTokens).all() as AgentTokenRow[]).map(
      agentTokenEntry,
    );
  }
  create(value: unknown) {
    const input = agentTokenInput(value);
    const token = `brew_${input.scopes === 'write' ? 'rw' : 'ro'}_${randomBytes(32).toString('base64url')}`;
    const now = this.clock.now().getTime();
    const row = this.database.sqlite
      .prepare(insertAgentToken)
      .get(input.name, hash(token), input.scopes, now + input.days * 86400000, now) as
      AgentTokenRow | undefined;
    if (!row) throw new ActionError(409, 'Revoke an old token before creating another.');
    return { token, entry: agentTokenEntry(row) };
  }
  revoke(id: number) {
    this.database.sqlite.prepare('DELETE FROM api_tokens WHERE id=?').run(id);
  }
  authenticate(authorization: string | null): AgentConnection | null {
    const secret = agentBearerSecret(authorization);
    if (!secret) return null;
    const now = this.clock.now().getTime();
    const row = this.database.sqlite.prepare(authenticateAgentToken).get(now, hash(secret), now) as
      AgentTokenRow | undefined;
    return row ? agentConnection(row) : null;
  }
  current(tokenId: number): AgentConnection | null {
    const now = this.clock.now().getTime();
    const row = this.database.sqlite.prepare(currentAgentToken).get(now, tokenId, now) as
      AgentTokenRow | undefined;
    return row ? agentConnection(row) : null;
  }
  record(connection: AgentConnection, tool: string, outcome: 'complete' | 'failed') {
    this.database.sqlite
      .prepare(insertAgentActivity)
      .run(
        connection.tokenId ?? null,
        connection.name ?? 'mcp',
        tool,
        '{}',
        agentActivityResult(tool, outcome),
        this.clock.now().getTime(),
      );
  }
  activity(before?: number) {
    this.actions.cleanup();
    const rows = this.database.sqlite
      .prepare(listAgentActivity)
      .all(before ?? Number.MAX_SAFE_INTEGER) as AgentActivityRow[];
    return agentActivityPage(rows, (row) => this.actions.receipt(row.id));
  }
}
