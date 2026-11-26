import { createHash, randomBytes } from 'node:crypto';
import type { BrewDatabase } from '../db/database.js';
import type {
  AgentAccessPort,
  AgentToken,
  AgentConnection,
} from '../../../../packages/core/src/agent-access.js';
import { ActionError } from '../../../../packages/core/src/actions.js';
import type { ClockPort } from '../../../../packages/core/src/ports.js';
import type { NodeActionStorage } from './action-storage.js';
import { nodeClock } from './runtime.js';

interface TokenRow {
  id: number;
  name: string;
  scopes: 'read' | 'write';
  expires_at: number;
  last_used_at: number | null;
  created_at: number;
}
const entry = (row: TokenRow): AgentToken => ({
  id: row.id,
  name: row.name,
  scopes: row.scopes,
  expiresAt: new Date(row.expires_at).toISOString(),
  lastUsedAt: row.last_used_at === null ? null : new Date(row.last_used_at).toISOString(),
  createdAt: new Date(row.created_at).toISOString(),
});
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const labels: Record<string, string> = {
  search_items: 'Searched the library',
  list_unread: 'Listed unread articles',
  get_item: 'Read an article',
  mark_read: 'Reviewed a read batch',
  star: 'Requested starred state change',
  tag: 'Requested article tags',
  add_feed: 'Requested a feed subscription',
  create_rule: 'Previewed a rule',
  list_brews: 'Listed Brews',
  get_brew: 'Read a Brew',
  preview_brew: 'Previewed a Brew',
  undo: 'Requested Undo',
};

export class NodeAgentAccess implements AgentAccessPort {
  constructor(
    private readonly database: BrewDatabase,
    private readonly actions: NodeActionStorage,
    private readonly clock: Pick<ClockPort, 'now'> = nodeClock,
  ) {}
  list() {
    return (
      this.database.sqlite
        .prepare(
          'SELECT id,name,scopes,expires_at,last_used_at,created_at FROM api_tokens ORDER BY id DESC',
        )
        .all() as TokenRow[]
    ).map(entry);
  }
  create(value: unknown) {
    const input = value as Record<string, unknown> | null;
    if (
      !input ||
      Array.isArray(input) ||
      typeof input.name !== 'string' ||
      !input.name.trim() ||
      input.name.trim().length > 100 ||
      Array.from(input.name).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw new ActionError(400, 'Choose a token name of 1–100 characters.');
    if (Object.keys(input).some((key) => !['name', 'scopes', 'expiresInDays'].includes(key)))
      throw new ActionError(400, 'Choose name, scopes and expiresInDays only.');
    const scopes = input.scopes === undefined ? 'read' : input.scopes;
    const days = input.expiresInDays === undefined ? 30 : input.expiresInDays;
    if (
      (scopes !== 'read' && scopes !== 'write') ||
      !Number.isInteger(days) ||
      Number(days) < 1 ||
      Number(days) > 365
    )
      throw new ActionError(400, 'Choose read or write access and an expiry of 1–365 days.');
    if (this.list().length >= 100)
      throw new ActionError(409, 'Revoke an old token before creating another.');
    const token = `brew_${scopes === 'write' ? 'rw' : 'ro'}_${randomBytes(32).toString('base64url')}`;
    const now = this.clock.now().getTime();
    const id = Number(
      this.database.sqlite
        .prepare(
          'INSERT INTO api_tokens(name,token_hash,scopes,expires_at,created_at) VALUES(?,?,?,?,?)',
        )
        .run(input.name.trim(), hash(token), scopes, now + Number(days) * 86400000, now)
        .lastInsertRowid,
    );
    return { token, entry: this.list().find((item) => item.id === id)! };
  }
  revoke(id: number) {
    this.database.sqlite.prepare('DELETE FROM api_tokens WHERE id=?').run(id);
  }
  authenticate(authorization: string | null): AgentConnection | null {
    if (!authorization || !/^Bearer brew_(?:ro|rw)_[a-zA-Z0-9_-]{43}$/.test(authorization))
      return null;
    const now = this.clock.now().getTime();
    const row = this.database.sqlite
      .prepare('SELECT id,name,scopes FROM api_tokens WHERE token_hash=? AND expires_at>?')
      .get(hash(authorization.slice(7)), now) as TokenRow | undefined;
    if (!row) return null;
    this.database.sqlite
      .prepare('UPDATE api_tokens SET last_used_at=? WHERE id=?')
      .run(now, row.id);
    return { tokenId: row.id, name: row.name, write: row.scopes === 'write' };
  }
  current(tokenId: number): AgentConnection | null {
    const row = this.database.sqlite
      .prepare('SELECT id,name,scopes FROM api_tokens WHERE id=? AND expires_at>?')
      .get(tokenId, this.clock.now().getTime()) as TokenRow | undefined;
    if (!row) return null;
    this.database.sqlite
      .prepare('UPDATE api_tokens SET last_used_at=? WHERE id=?')
      .run(this.clock.now().getTime(), row.id);
    return { tokenId: row.id, name: row.name, write: row.scopes === 'write' };
  }
  record(connection: AgentConnection, tool: string, outcome: 'complete' | 'failed') {
    this.database.sqlite
      .prepare(
        'INSERT INTO agent_actions(token_id,agent,tool,args_json,result_json,created_at) VALUES(?,?,?,?,?,?)',
      )
      .run(
        connection.tokenId ?? null,
        connection.name ?? 'mcp',
        tool,
        '{}',
        JSON.stringify({
          summary:
            outcome === 'failed'
              ? `${tool}: request refused or failed.`
              : `${labels[tool] ?? 'Used a tool'}.`,
          status: outcome,
        }),
        this.clock.now().getTime(),
      );
  }
  activity(before?: number) {
    this.actions.cleanup();
    const rows = this.database.sqlite
      .prepare(
        "SELECT id,agent,tool,result_json,created_at FROM agent_actions WHERE (token_id IS NOT NULL OR agent IN ('mcp','WebMCP','webmcp')) AND id<? ORDER BY id DESC LIMIT 21",
      )
      .all(before ?? Number.MAX_SAFE_INTEGER) as Array<{
      id: number;
      agent: string;
      tool: string;
      result_json: string;
      created_at: number;
    }>;
    const items = rows.slice(0, 20).map((row) => {
      const result = JSON.parse(row.result_json);
      return {
        id: row.id,
        agent: row.agent,
        tool: row.tool,
        summary: String(result.summary),
        createdAt: new Date(row.created_at).toISOString(),
        receipt: result.kind ? this.actions.receipt(row.id) : null,
      };
    });
    return { items, next: rows.length > 20 ? items[items.length - 1]!.id : null };
  }
}
