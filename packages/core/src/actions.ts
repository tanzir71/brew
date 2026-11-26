export type ActionKind = 'delete_feed' | 'delete_folder' | 'delete_rule' | 'apply_rule';
export interface ActionRequest {
  requestId?: string;
  kind: ActionKind;
  id: number;
  days?: number;
  confirm: true;
}
export interface ActionReceipt {
  id: number;
  kind: ActionKind;
  targetId: number;
  summary: string;
  status: 'pending' | 'complete' | 'failed' | 'undone';
  matched?: number;
  failedActions?: number;
  externalEffects: boolean;
  expiresAt: string | null;
  undoneAt: string | null;
  canUndo: boolean;
}
export class ActionError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409 | 410 | 428 | 501,
    message: string,
  ) {
    super(message);
  }
}
export interface ActionStoragePort {
  run(request: ActionRequest): Promise<ActionReceipt>;
  undo(id: number): ActionReceipt;
  recent(): ActionReceipt[];
  cleanup(): void;
  drain(): Promise<void>;
}
const validId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
/** Confirmed owner actions. Token authorization is handled separately by target ingress. */
export class ActionsService {
  constructor(private readonly storage: ActionStoragePort) {}
  run(value: unknown): Promise<ActionReceipt> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new ActionError(400, 'Choose an action.');
    const input = value as Record<string, unknown>;
    if (
      input.requestId !== undefined &&
      (typeof input.requestId !== 'string' || !/^[a-z\d_-]{16,80}$/i.test(input.requestId))
    )
      throw new ActionError(400, 'Choose a valid request identity.');
    if (
      typeof input.kind !== 'string' ||
      !['delete_feed', 'delete_folder', 'delete_rule', 'apply_rule'].includes(String(input.kind)) ||
      !validId(input.id)
    )
      throw new ActionError(400, 'Choose a valid action and item.');
    if (input.confirm !== true) throw new ActionError(428, 'Confirm this action first.');
    if (
      input.days !== undefined &&
      (!Number.isInteger(input.days) || Number(input.days) < 1 || Number(input.days) > 3650)
    )
      throw new ActionError(400, 'Choose 1–3650 days.');
    return this.storage.run({
      ...(input.requestId === undefined ? {} : { requestId: input.requestId as string }),
      kind: input.kind as ActionKind,
      id: input.id,
      confirm: true,
      ...(input.days === undefined ? {} : { days: Number(input.days) }),
    });
  }
  undo(id: unknown): ActionReceipt {
    if (!validId(id)) throw new ActionError(400, 'Choose a valid action.');
    return this.storage.undo(id);
  }
  cleanup() {
    this.storage.cleanup();
  }
  recent() {
    return this.storage.recent();
  }
  drain() {
    return this.storage.drain();
  }
}
