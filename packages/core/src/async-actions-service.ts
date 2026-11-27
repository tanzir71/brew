import {
  ActionError,
  actionRequest,
  type ActionContext,
  type ActionReceipt,
  type ActionRequest,
} from './actions.js';
import { readActionTarget, type ReadActionTarget, type ReadActionPreview } from './read-actions.js';

export interface AsyncActionStoragePort {
  previewRead(target: ReadActionTarget): Promise<ReadActionPreview>;
  run(request: ActionRequest): Promise<ActionReceipt>;
  undo(id: number, tokenId?: number): Promise<ActionReceipt>;
  recent(): Promise<ActionReceipt[]>;
  cleanup(): Promise<void>;
  drain(): Promise<void>;
}
export class AsyncActionsService {
  constructor(private storage: AsyncActionStoragePort) {}
  async previewRead(value: unknown) {
    try {
      return await this.storage.previewRead(readActionTarget(value));
    } catch (error) {
      if (error instanceof ActionError) throw error;
      throw new ActionError(400, (error as Error).message);
    }
  }
  run(value: unknown, context?: ActionContext) {
    return this.storage.run(actionRequest(value, context));
  }
  undo(id: unknown, tokenId?: number) {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1)
      throw new ActionError(400, 'Choose a valid action.');
    return this.storage.undo(id, tokenId);
  }
  recent() {
    return this.storage.recent();
  }
  cleanup() {
    return this.storage.cleanup();
  }
  drain() {
    return this.storage.drain();
  }
}
