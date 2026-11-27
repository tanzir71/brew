import type { ActionRequest, ActionReceipt } from './actions.js';
export const actionUndoMs = 30000;
export const tokenWriteKinds = ['mark_read', 'star_item', 'tag_item', 'add_feed'];
export interface StoredAction {
  id: number;
  token_id: number | null;
  tool: ActionRequest['kind'];
  args_json: string;
  result_json: string;
  undo_json: string | null;
  undone_at: number | null;
}
export function actionRequestKey(request: ActionRequest) {
  return (
    request.requestId &&
    (request.tokenId === undefined
      ? request.requestId
      : `token:${request.tokenId}:${request.requestId}`)
  );
}
export function actionArgumentPlan(request: ActionRequest): {
  fields: Record<string, unknown>;
  value?: string;
  key?: 'sha256' | 'revision';
} {
  if (['star_item', 'tag_item', 'add_feed', 'create_rule'].includes(request.kind)) {
    const input = {
      ...request,
      requestId: undefined,
      actor: undefined,
      tokenId: undefined,
      agentName: undefined,
      signal: undefined,
      readerGeneration: undefined,
      confirm: undefined,
    };
    return { fields: {}, value: JSON.stringify(input), key: 'sha256' };
  }
  if (request.kind === 'copy_rule')
    return { fields: { id: request.id }, value: request.definition, key: 'revision' };
  if (request.kind === 'mark_read')
    return {
      fields: { revision: request.revision },
      value: JSON.stringify(request.target),
      key: 'sha256',
    };
  if (request.kind === 'update_sender')
    return {
      fields: { id: request.id, revision: request.revision },
      value: JSON.stringify(request.patch),
      key: 'sha256',
    };
  if (request.kind === 'import_opml') return { fields: {}, value: request.opml, key: 'sha256' };
  return {
    fields: {
      id: 'id' in request ? request.id : null,
      ...(request.kind === 'apply_rule' ? { days: request.days ?? 30 } : {}),
    },
  };
}
export function actionArguments(plan: ReturnType<typeof actionArgumentPlan>, hash?: string) {
  return JSON.stringify({ ...plan.fields, ...(plan.key ? { [plan.key]: hash } : {}) });
}
export function actionReceipt(row: StoredAction, at: number, running: boolean): ActionReceipt {
  const { _lease, ...result } = JSON.parse(row.result_json) as ActionReceipt & { _lease?: unknown };
  void _lease;
  const expires = row.undo_json ? (JSON.parse(row.undo_json).expiresAt as number) : null;
  const interrupted = result.status === 'pending' && !running;
  return {
    ...result,
    id: row.id,
    status: row.undone_at !== null ? 'undone' : interrupted ? 'failed' : result.status,
    ...(interrupted
      ? { summary: 'Rule application was interrupted. Undo can restore its local changes.' }
      : {}),
    expiresAt: expires === null ? null : new Date(expires).toISOString(),
    undoneAt: row.undone_at !== null ? new Date(row.undone_at).toISOString() : null,
    canUndo: expires !== null && expires > at && row.undone_at === null && !running,
  };
}
