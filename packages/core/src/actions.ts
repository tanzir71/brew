import { opmlDocument, type OpmlImportResult } from './opml.js';
import { newsletterSettingsPatch } from './newsletter-settings.js';
import type { NewsletterSettingsPatch } from './types/newsletters.js';
import { agentWrite, type AgentWrite } from './agent-writes.js';
import { readActionTarget, type ReadActionTarget, type ReadActionPreview } from './read-actions.js';
export type ItemActionKind = 'delete_feed' | 'delete_folder' | 'delete_rule' | 'apply_rule';
export type ActionKind =
  ItemActionKind | 'import_opml' | 'update_sender' | 'mark_read' | 'copy_rule' | AgentWrite['kind'];
export type ActionInput =
  | AgentWrite
  | { kind: ItemActionKind; id: number; days?: number }
  | { kind: 'import_opml'; opml: string }
  | { kind: 'update_sender'; id: number; patch: NewsletterSettingsPatch; revision: string }
  | { kind: 'mark_read'; target: ReadActionTarget; revision: string }
  | { kind: 'copy_rule'; id: number; definition: string };
export type ActionIntentRequest = ActionInput & { requestId?: string };
export type ActionRequest = ActionIntentRequest & {
  confirm: true;
  actor?: 'mcp';
  tokenId?: number;
  agentName?: string;
};
export interface ActionReceipt {
  id: number;
  kind: ActionKind;
  targetId: number | null;
  summary: string;
  status: 'pending' | 'complete' | 'failed' | 'undone';
  matched?: number;
  failedActions?: number;
  imported?: OpmlImportResult['imported'];
  skipped?: OpmlImportResult['skipped'];
  foldersCreated?: OpmlImportResult['foldersCreated'];
  lettersRemoved?: number;
  originalsRemoved?: number;
  updated?: number;
  externalEffects: boolean;
  expiresAt: string | null;
  undoneAt: string | null;
  canUndo: boolean;
}
export class ActionError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 428 | 501,
    message: string,
  ) {
    super(message);
  }
}
export interface ActionStoragePort {
  previewRead(target: ReadActionTarget): ReadActionPreview;
  run(request: ActionRequest): Promise<ActionReceipt>;
  undo(id: number, tokenId?: number): ActionReceipt;
  recent(): ActionReceipt[];
  cleanup(): void;
  drain(): Promise<void>;
}
const validId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
/** Confirmed owner actions. Token authorization is handled separately by target ingress. */
export class ActionsService {
  constructor(private readonly storage: ActionStoragePort) {}
  previewRead(value: unknown): ReadActionPreview {
    try {
      return this.storage.previewRead(readActionTarget(value));
    } catch (error) {
      if (error instanceof ActionError) throw error;
      throw new ActionError(400, (error as Error).message);
    }
  }
  run(
    value: unknown,
    context?: { agent: 'mcp'; tokenId?: number; name?: string },
  ): Promise<ActionReceipt> {
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
      ![
        'delete_feed',
        'delete_folder',
        'delete_rule',
        'apply_rule',
        'import_opml',
        'update_sender',
        'mark_read',
        'copy_rule',
        'star_item',
        'tag_item',
        'add_feed',
        'create_rule',
      ].includes(String(input.kind)) ||
      (!['import_opml', 'mark_read', 'add_feed', 'create_rule'].includes(String(input.kind)) &&
        !validId(input.id))
    )
      throw new ActionError(400, 'Choose a valid action and item.');
    if (input.confirm !== true) throw new ActionError(428, 'Confirm this action first.');
    const identity = {
      ...(input.requestId === undefined ? {} : { requestId: input.requestId as string }),
      ...(context?.agent === 'mcp' ? { actor: 'mcp' as const } : {}),
      ...(context?.tokenId === undefined
        ? {}
        : { tokenId: context.tokenId, agentName: context.name }),
    };
    try {
      const parsed = agentWrite(input);
      if (parsed) return this.storage.run({ ...parsed, ...identity, confirm: true });
    } catch (error) {
      throw new ActionError(400, error instanceof Error ? error.message : 'Invalid action.');
    }
    if (input.kind === 'copy_rule') {
      if (typeof input.definition !== 'string' || input.definition.length > 1_000_000)
        throw new ActionError(400, 'Choose the saved rule to copy.');
      try {
        if (JSON.parse(input.definition)?.id !== input.id)
          throw new Error('Invalid saved definition');
      } catch {
        throw new ActionError(400, 'Choose the saved rule to copy.');
      }
      return this.storage.run({
        ...identity,
        kind: 'copy_rule',
        id: input.id as number,
        definition: input.definition,
        confirm: true,
      });
    }
    if (input.kind === 'mark_read') {
      if (typeof input.revision !== 'string' || !/^[a-f\d]{64}$/.test(input.revision))
        throw new ActionError(400, 'Review the current unread articles first.');
      try {
        const target = readActionTarget(input.target);
        return this.storage.run({
          ...identity,
          kind: 'mark_read',
          target,
          revision: input.revision,
          confirm: true,
        });
      } catch (error) {
        if (error instanceof ActionError) throw error;
        throw new ActionError(400, (error as Error).message);
      }
    }
    if (input.kind === 'update_sender') {
      if (typeof input.revision !== 'string' || !/^[a-f\d]{64}$/.test(input.revision))
        throw new ActionError(400, 'Review current sender settings first.');
      try {
        const patch = newsletterSettingsPatch(input.patch);
        if (!Object.keys(patch).length) throw new Error('Choose at least one sender setting.');
        return this.storage.run({
          ...identity,
          kind: 'update_sender',
          id: input.id as number,
          patch,
          revision: input.revision,
          confirm: true,
        });
      } catch (error) {
        if (error instanceof ActionError) throw error;
        throw new ActionError(400, (error as Error).message);
      }
    }
    if (input.kind === 'import_opml') {
      try {
        return this.storage.run({
          ...identity,
          kind: 'import_opml',
          opml: opmlDocument(input.opml),
          confirm: true,
        });
      } catch (error) {
        if (error instanceof ActionError) throw error;
        throw new ActionError(400, (error as Error).message);
      }
    }
    if (
      input.days !== undefined &&
      (!Number.isInteger(input.days) || Number(input.days) < 1 || Number(input.days) > 3650)
    )
      throw new ActionError(400, 'Choose 1–3650 days.');
    return this.storage.run({
      ...identity,
      kind: input.kind as ItemActionKind,
      id: input.id as number,
      confirm: true,
      ...(input.days === undefined ? {} : { days: Number(input.days) }),
    });
  }
  undo(id: unknown, tokenId?: number): ActionReceipt {
    if (!validId(id)) throw new ActionError(400, 'Choose a valid action.');
    return this.storage.undo(id, tokenId);
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
