import type { BrewDatabase } from '../db/database.js';
import type { ClockPort, RuleStoragePort } from '../../../../packages/core/src/ports.js';
import {
  ActionError,
  type ActionReceipt,
  type ActionRequest,
  type ActionStoragePort,
} from '../../../../packages/core/src/actions.js';
import { RulesService } from '../../../../packages/core/src/rules-service.js';
import { NodeRuleStorage } from './rule-storage.js';
import { ActionJournal } from './action-journal.js';
import { nodeClock, nodeRegex } from './runtime.js';

const undoMs = 30_000;
interface Stored {
  id: number;
  tool: ActionRequest['kind'];
  args_json: string;
  result_json: string;
  undo_json: string | null;
  undone_at: number | null;
}
export class NodeActionStorage implements ActionStoragePort {
  private readonly journal: ActionJournal;
  private readonly running = new Set<number>();
  private readonly requests = new Map<
    string,
    { signature: string; task: Promise<ActionReceipt> }
  >();
  private args(request: ActionRequest) {
    return JSON.stringify({
      id: request.id,
      ...(request.kind === 'apply_rule' ? { days: request.days ?? 30 } : {}),
    });
  }
  private readonly tasks = new Set<Promise<ActionReceipt>>();
  constructor(
    private readonly database: BrewDatabase,
    private readonly clock: Pick<ClockPort, 'now'> = nodeClock,
    private readonly fetcher: typeof fetch = globalThis.fetch,
    private readonly notify: (value: { id: number; title: string; url: string }) => void = () =>
      undefined,
  ) {
    this.journal = new ActionJournal(database);
    this.cleanup();
  }
  private metadata(id: number): ActionReceipt {
    const row = this.database.sqlite.prepare('SELECT * FROM agent_actions WHERE id=?').get(id) as
      Stored | undefined;
    if (!row) throw new ActionError(404, 'Action not found.');
    const result = JSON.parse(row.result_json) as ActionReceipt;
    const expires = row.undo_json ? (JSON.parse(row.undo_json).expiresAt as number) : null;
    const interrupted = result.status === 'pending' && !this.running.has(id);
    return {
      ...result,
      id,
      status: row.undone_at !== null ? 'undone' : interrupted ? 'failed' : result.status,
      ...(interrupted
        ? { summary: 'Rule application was interrupted. Undo can restore its local changes.' }
        : {}),
      expiresAt: expires === null ? null : new Date(expires).toISOString(),
      undoneAt: row.undone_at !== null ? new Date(row.undone_at).toISOString() : null,
      canUndo:
        expires !== null &&
        expires > this.clock.now().getTime() &&
        row.undone_at === null &&
        !this.running.has(id),
    };
  }
  private create(request: ActionRequest, summary: string, externalEffects: boolean) {
    const result = {
      kind: request.kind,
      targetId: request.id,
      summary,
      status: 'pending',
      externalEffects,
    };
    return Number(
      this.database.sqlite
        .prepare(
          "INSERT INTO agent_actions(agent,request_id,tool,args_json,result_json,undo_json,created_at) VALUES('web',?,?,?,?,?,?)",
        )
        .run(
          request.requestId ?? null,
          request.kind,
          this.args(request),
          JSON.stringify(result),
          JSON.stringify({ version: 1, expiresAt: this.clock.now().getTime() + undoMs }),
          this.clock.now().getTime(),
        ).lastInsertRowid,
    );
  }
  private write<T>(id: number, run: () => T): T {
    return this.journal.write(id, () => {
      this.database.sqlite
        .prepare(
          "UPDATE agent_actions SET undo_json=json_set(undo_json,'$.expiresAt',?) WHERE id=?",
        )
        .run(this.clock.now().getTime() + undoMs, id);
      return run();
    });
  }
  run(request: ActionRequest): Promise<ActionReceipt> {
    const signature = `${request.kind}:${this.args(request)}`;
    const existing = request.requestId ? this.requests.get(request.requestId) : undefined;
    if (existing) {
      if (existing.signature !== signature)
        throw new ActionError(409, 'This request was already used for another action.');
      return existing.task;
    }
    const task = this.execute(request).finally(() => {
      this.tasks.delete(task);
      if (request.requestId) this.requests.delete(request.requestId);
    });
    this.tasks.add(task);
    if (request.requestId) this.requests.set(request.requestId, { signature, task });
    return task;
  }
  private async execute(request: ActionRequest): Promise<ActionReceipt> {
    this.cleanup();
    if (request.requestId) {
      const prior = this.database.sqlite
        .prepare('SELECT id,tool,args_json FROM agent_actions WHERE request_id=?')
        .get(request.requestId) as Stored | undefined;
      if (prior) {
        if (prior.tool !== request.kind || prior.args_json !== this.args(request))
          throw new ActionError(409, 'This request was already used for another action.');
        return this.metadata(prior.id);
      }
    }
    const table =
      request.kind === 'delete_feed'
        ? 'feeds'
        : request.kind === 'delete_folder'
          ? 'folders'
          : 'rules';
    const item = this.database.sqlite
      .prepare(`SELECT * FROM ${table} WHERE id=?`)
      .get(request.id) as { title?: string; name?: string; actions_json?: string } | undefined;
    if (!item) throw new ActionError(404, 'Item not found.');
    const title = item.title ?? item.name ?? 'item';
    if (request.kind !== 'apply_rule') {
      return this.database.sqlite.transaction(() => {
        const id = this.create(request, `Deleted ${title}.`, false);
        this.write(id, () =>
          this.database.sqlite.prepare(`DELETE FROM ${table} WHERE id=?`).run(request.id),
        );
        this.database.sqlite
          .prepare(
            "UPDATE agent_actions SET result_json=json_set(result_json,'$.status','complete') WHERE id=?",
          )
          .run(id);
        return this.metadata(id);
      })();
    }
    const external = (JSON.parse(item.actions_json!) as Array<{ type: string }>).some((action) =>
      ['webhook', 'notify'].includes(action.type),
    );
    const id = this.create(request, `Applying ${title}…`, external);
    this.running.add(id);
    const storage = new NodeRuleStorage(this.database);
    let failedActions = 0;
    const recorded: RuleStoragePort = {
      context: storage.context.bind(storage),
      definitions: storage.definitions.bind(storage),
      list: storage.list.bind(storage),
      create: storage.create.bind(storage),
      update: storage.update.bind(storage),
      delete: storage.delete.bind(storage),
      articleIds: storage.articleIds.bind(storage),
      publishedAt: storage.publishedAt.bind(storage),
      logs: storage.logs.bind(storage),
      addTag: (...args) => this.write(id, () => storage.addTag(...args)),
      removeTag: (...args) => this.write(id, () => storage.removeTag(...args)),
      updateArticle: (...args) => this.write(id, () => storage.updateArticle(...args)),
      log: (...args) => {
        failedActions += args[2].filter((result) => !result.ok).length;
        this.write(id, () => storage.log(...args));
      },
    };
    try {
      const rules = new RulesService(
        recorded,
        nodeRegex,
        { fetch: this.fetcher },
        { notify: this.notify },
        { now: () => this.clock.now(), monotonic: nodeClock.monotonic },
      );
      const matched = await rules.applyToExisting(request.id, request.days ?? 30);
      this.database.sqlite
        .prepare('UPDATE agent_actions SET result_json=?,undo_json=? WHERE id=?')
        .run(
          JSON.stringify({
            kind: request.kind,
            targetId: request.id,
            summary: `Applied to ${matched} existing article${matched === 1 ? '' : 's'}.${failedActions ? ` ${failedActions} action${failedActions === 1 ? '' : 's'} failed. Undo can restore local changes.` : ''}`,
            status: failedActions ? 'failed' : 'complete',
            externalEffects: external,
            matched,
            failedActions,
          }),
          JSON.stringify({ version: 1, expiresAt: this.clock.now().getTime() + undoMs }),
          id,
        );
    } catch {
      this.database.sqlite
        .prepare(
          "UPDATE agent_actions SET result_json=json_set(result_json,'$.status','failed','$.summary','Could not finish applying the rule. Undo can restore local changes.') WHERE id=?",
        )
        .run(id);
    } finally {
      this.running.delete(id);
    }
    return this.metadata(id);
  }
  undo(id: number): ActionReceipt {
    this.cleanup();
    return this.database.sqlite.transaction(() => {
      const receipt = this.metadata(id);
      if (receipt.status === 'undone') return receipt;
      if (this.running.has(id)) throw new ActionError(409, 'Wait for the action to finish.');
      if (!receipt.canUndo) throw new ActionError(410, 'The Undo window has expired.');
      try {
        this.journal.restore(id);
      } catch (error) {
        if (error instanceof ActionError) throw error;
        throw new ActionError(
          409,
          'These items changed after the action. Undo could not restore them.',
        );
      }
      this.database.sqlite
        .prepare('UPDATE agent_actions SET undone_at=?,undo_json=NULL WHERE id=?')
        .run(this.clock.now().getTime(), id);
      this.database.sqlite.prepare('DELETE FROM agent_action_changes WHERE action_id=?').run(id);
      return this.metadata(id);
    })();
  }
  recent(): ActionReceipt[] {
    this.cleanup();
    return (
      this.database.sqlite
        .prepare('SELECT id FROM agent_actions ORDER BY id DESC LIMIT 20')
        .all() as Array<{ id: number }>
    ).map(({ id }) => this.metadata(id));
  }
  cleanup(): void {
    const expired = this.database.sqlite
      .prepare(
        "SELECT id FROM agent_actions WHERE undo_json IS NOT NULL AND json_extract(undo_json,'$.expiresAt')<=?",
      )
      .all(this.clock.now().getTime()) as Array<{ id: number }>;
    this.database.sqlite.transaction(() => {
      for (const { id } of expired)
        if (!this.running.has(id)) {
          this.database.sqlite
            .prepare('DELETE FROM agent_action_changes WHERE action_id=?')
            .run(id);
          this.database.sqlite
            .prepare('UPDATE agent_actions SET undo_json=NULL WHERE id=?')
            .run(id);
        }
    })();
  }
  async drain() {
    await Promise.allSettled([...this.tasks]);
  }
}
