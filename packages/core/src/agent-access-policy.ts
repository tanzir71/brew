import { ActionError, type ActionReceipt } from './actions.js';
import type { AgentConnection, AgentToken } from './agent-access.js';

export interface AgentTokenRow {
  id: number;
  name: string;
  scopes: 'read' | 'write';
  expires_at: number;
  last_used_at: number | null;
  created_at: number;
}
export const agentTokenEntry = (row: AgentTokenRow): AgentToken => ({
  id: row.id,
  name: row.name,
  scopes: row.scopes,
  expiresAt: new Date(row.expires_at).toISOString(),
  lastUsedAt: row.last_used_at === null ? null : new Date(row.last_used_at).toISOString(),
  createdAt: new Date(row.created_at).toISOString(),
});
export const agentConnection = (
  row: Pick<AgentTokenRow, 'id' | 'name' | 'scopes'>,
): AgentConnection => ({
  tokenId: row.id,
  name: row.name,
  write: row.scopes === 'write',
});
export const agentBearerSecret = (authorization: string | null) =>
  authorization && /^Bearer brew_(?:ro|rw)_[a-zA-Z0-9_-]{43}$/.test(authorization)
    ? authorization.slice(7)
    : null;

export function agentTokenInput(value: unknown) {
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
  return { name: input.name.trim(), scopes, days: Number(days) };
}
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
export const agentActivityResult = (tool: string, outcome: 'complete' | 'failed') =>
  JSON.stringify({
    summary:
      outcome === 'failed'
        ? `${tool}: request refused or failed.`
        : `${labels[tool] ?? 'Used a tool'}.`,
    status: outcome,
  });
export interface AgentActivityRow {
  id: number;
  agent: string;
  tool: string;
  result_json: string;
  undo_json: string | null;
  undone_at: number | null;
  created_at: number;
}
export function agentActivityPage(
  rows: AgentActivityRow[],
  receipt: (row: AgentActivityRow) => ActionReceipt,
) {
  const items = rows.slice(0, 20).map((row) => {
    const result = JSON.parse(row.result_json);
    return {
      id: row.id,
      agent: row.agent,
      tool: row.tool,
      summary: String(result.summary),
      createdAt: new Date(row.created_at).toISOString(),
      receipt: result.kind ? receipt(row) : null,
    };
  });
  return { items, next: rows.length > 20 ? items[items.length - 1]!.id : null };
}
