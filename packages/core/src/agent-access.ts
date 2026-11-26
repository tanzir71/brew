import type { ActionReceipt } from './actions.js';

export interface AgentConnection {
  write: boolean;
  agent?: 'mcp' | 'webmcp';
  tokenId?: number;
  name?: string;
}
export interface AgentToken {
  id: number;
  name: string;
  scopes: 'read' | 'write';
  expiresAt: string;
  lastUsedAt: string | null;
  createdAt: string;
}
export interface AgentActivity {
  id: number;
  agent: string;
  tool: string;
  summary: string;
  createdAt: string;
  receipt: ActionReceipt | null;
}
/** Secrets and cryptography belong to the target, never to the portable core. */
export interface AgentAccessPort {
  list(): AgentToken[];
  create(value: unknown): { token: string; entry: AgentToken };
  revoke(id: number): void;
  authenticate(authorization: string | null): AgentConnection | null;
  current(tokenId: number): AgentConnection | null;
  record(connection: AgentConnection, tool: string, outcome: 'complete' | 'failed'): void;
  activity(before?: number): { items: AgentActivity[]; next: number | null };
}
