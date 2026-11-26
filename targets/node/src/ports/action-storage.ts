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
import { createHash } from 'node:crypto';
import { OpmlService } from '../services/opml-service.js';
import { NewsletterLibrary } from '../services/newsletter-library.js';
import { ReadActions } from '../services/read-actions.js';
import { ArticleService } from '../services/article-service.js';
import { FeedService } from '../services/feed-service.js';
import type { ReadActionTarget } from '../../../../packages/core/src/read-actions.js';
import { copiedRuleDraft, ruleCopySource } from '../../../../packages/core/src/rule-copy.js';

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
    if (['star_item', 'tag_item', 'add_feed', 'create_rule'].includes(request.kind)) {
      const input = { ...request, requestId: undefined, actor: undefined, confirm: undefined };
      return JSON.stringify({
        sha256: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
      });
    }
    if (request.kind === 'copy_rule')
      return JSON.stringify({
        id: request.id,
        revision: createHash('sha256').update(request.definition).digest('hex'),
      });
    if (request.kind === 'mark_read')
      return JSON.stringify({
        revision: request.revision,
        sha256: createHash('sha256').update(JSON.stringify(request.target)).digest('hex'),
      });
    if (request.kind === 'update_sender')
      return JSON.stringify({
        id: request.id,
        revision: request.revision,
        sha256: createHash('sha256').update(JSON.stringify(request.patch)).digest('hex'),
      });
    if (request.kind === 'import_opml')
      return JSON.stringify({ sha256: createHash('sha256').update(request.opml).digest('hex') });
    return JSON.stringify({
      id: 'id' in request ? request.id : null,
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
      targetId: 'id' in request ? request.id : null,
      summary,
      status: 'pending',
      externalEffects,
    };
    return Number(
      this.database.sqlite
        .prepare(
          'INSERT INTO agent_actions(agent,request_id,tool,args_json,result_json,undo_json,created_at) VALUES(?,?,?,?,?,?,?)',
        )
        .run(
          request.actor ?? 'web',
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
  previewRead(target: ReadActionTarget) {
    return new ReadActions(this.database, () => this.clock.now()).inspect(target).preview;
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
    if (request.kind === 'copy_rule') {
      return this.database.sqlite.transaction(() => {
        const storage = new NodeRuleStorage(this.database);
        const source = storage.definitions().find((rule) => rule.id === request.id);
        if (!source) throw new ActionError(404, 'Rule not found.');
        if (ruleCopySource(source) !== request.definition)
          throw new ActionError(
            409,
            'The saved rule changed. Close this result, refresh rules and choose Copy again.',
          );
        const id = this.create(request, `Copying ${source.name}…`, false);
        let copied;
        try {
          const rules = new RulesService(
            storage,
            nodeRegex,
            { fetch: this.fetcher },
            { notify: this.notify },
            { now: () => this.clock.now(), monotonic: nodeClock.monotonic },
          );
          copied = this.write(id, () => rules.create(copiedRuleDraft(source)));
        } catch {
          throw new ActionError(400, 'Could not copy this saved rule. Check its definition.');
        }
        this.database.sqlite.prepare('UPDATE agent_actions SET result_json=? WHERE id=?').run(
          JSON.stringify({
            kind: request.kind,
            targetId: copied.id,
            summary: `Copied “${source.name}” as a disabled rule.`,
            status: 'complete',
            externalEffects: false,
          }),
          id,
        );
        return this.metadata(id);
      })();
    }
    if (
      request.kind === 'star_item' ||
      request.kind === 'tag_item' ||
      request.kind === 'create_rule' ||
      request.kind === 'add_feed'
    ) {
      const feedService = new FeedService(this.database, this.fetcher);
      // Network work never runs while the synchronous journal flag/transaction is active.
      const prepared =
        request.kind === 'add_feed'
          ? await feedService.prepareAdd(request.url, request.folderId)
          : null;
      return this.database.sqlite.transaction(() => {
        const id = this.create(request, 'Applying agent change…', false);
        const targetId = this.write(id, () => {
          const articles = new ArticleService(this.database, this.fetcher, () => this.clock.now());
          if (request.kind === 'star_item') {
            if (!articles.updateState(request.id, { starred: request.starred }))
              throw new ActionError(404, 'Article not found.');
            return request.id;
          }
          if (request.kind === 'tag_item') {
            if (!articles.get(request.id)) throw new ActionError(404, 'Article not found.');
            const existing = articles.listTags();
            const add = request.add.map((name) => articles.createTag(name).id);
            const remove = request.remove.flatMap((name) =>
              existing.filter((tag) => tag.name === name).map((tag) => tag.id),
            );
            articles.changeTags(request.id, { add, remove });
            return request.id;
          }
          if (request.kind === 'add_feed') return feedService.insertPrepared(prepared!).id;
          const rules = new RulesService(
            new NodeRuleStorage(this.database),
            nodeRegex,
            { fetch: this.fetcher },
            { notify: this.notify },
            { now: () => this.clock.now(), monotonic: nodeClock.monotonic },
          );
          return rules.create(request.draft).id;
        });
        const summaries = {
          star_item: 'Updated starred state.',
          tag_item: 'Updated article tags.',
          add_feed: 'Subscribed to feed.',
          create_rule: 'Created rule without running its actions.',
        };
        this.database.sqlite
          .prepare('UPDATE agent_actions SET result_json=? WHERE id=?')
          .run(
            JSON.stringify({
              kind: request.kind,
              targetId,
              summary: summaries[request.kind],
              status: 'complete',
              externalEffects: false,
            }),
            id,
          );
        return this.metadata(id);
      })();
    }
    if (request.kind === 'mark_read') {
      return this.database.sqlite.transaction(() => {
        const service = new ReadActions(this.database, () => this.clock.now());
        const { ids, preview } = service.inspect(request.target);
        if (preview.revision !== request.revision)
          throw new ActionError(
            409,
            'The unread articles changed. Close this confirmation and review the scope again.',
          );
        const id = this.create(request, 'Marking articles read…', false);
        this.write(id, () => service.apply(ids));
        this.database.sqlite
          .prepare('UPDATE agent_actions SET result_json=?,undo_json=? WHERE id=?')
          .run(
            JSON.stringify({
              kind: request.kind,
              targetId: null,
              summary: `Marked ${ids.length} read.`,
              status: 'complete',
              externalEffects: false,
              updated: ids.length,
            }),
            ids.length
              ? JSON.stringify({ version: 1, expiresAt: this.clock.now().getTime() + undoMs })
              : null,
            id,
          );
        return this.metadata(id);
      })();
    }
    if (request.kind === 'update_sender') {
      return this.database.sqlite.transaction(() => {
        const library = new NewsletterLibrary(this.database, {
          now: () => this.clock.now(),
          monotonic: nodeClock.monotonic,
        });
        let preview;
        try {
          preview = library.previewSenderSettings(request.id, request.patch);
        } catch (error) {
          throw new ActionError(400, (error as Error).message);
        }
        if (!preview) throw new ActionError(404, 'Sender not found.');
        if (preview.revision !== request.revision)
          throw new ActionError(
            409,
            'The sender or affected content changed. Close this confirmation and review the settings again.',
          );
        const id = this.create(request, 'Saving sender settings…', false);
        this.write(id, () => library.updateSender(request.id, request.patch));
        const changed =
          (
            this.database.sqlite
              .prepare('SELECT count(*) AS n FROM agent_action_changes WHERE action_id=?')
              .get(id) as { n: number }
          ).n > 0;
        this.database.sqlite
          .prepare('UPDATE agent_actions SET result_json=?,undo_json=? WHERE id=?')
          .run(
            JSON.stringify({
              kind: request.kind,
              targetId: request.id,
              summary: changed
                ? `Saved settings for “${preview.senderTitle}”.${preview.lettersRemoved || preview.originalsRemoved ? ` Removed ${preview.lettersRemoved} letters; cleared ${preview.originalsRemoved} originals.` : ''}`
                : 'Sender settings were already current.',
              status: 'complete',
              externalEffects: false,
              lettersRemoved: preview.lettersRemoved,
              originalsRemoved: preview.originalsRemoved,
            }),
            changed
              ? JSON.stringify({ version: 1, expiresAt: this.clock.now().getTime() + undoMs })
              : null,
            id,
          );
        return this.metadata(id);
      })();
    }
    if (request.kind === 'import_opml') {
      const opml = new OpmlService(this.database);
      try {
        opml.preview(request.opml);
      } catch {
        throw new ActionError(400, 'Invalid OPML document. Check the file and its feed URLs.');
      }
      return this.database.sqlite.transaction(() => {
        const id = this.create(request, 'Importing OPML…', false);
        const result = this.write(id, () => opml.import(request.opml));
        this.database.sqlite
          .prepare('UPDATE agent_actions SET result_json=?,undo_json=? WHERE id=?')
          .run(
            JSON.stringify({
              kind: request.kind,
              targetId: null,
              summary: `Imported ${result.imported} ${result.imported === 1 ? 'feed' : 'feeds'}; skipped ${result.skipped} existing or duplicate ${result.skipped === 1 ? 'feed' : 'feeds'}; created ${result.foldersCreated} ${result.foldersCreated === 1 ? 'folder' : 'folders'}.`,
              status: 'complete',
              externalEffects: false,
              ...result,
            }),
            result.imported || result.foldersCreated
              ? JSON.stringify({ version: 1, expiresAt: this.clock.now().getTime() + undoMs })
              : null,
            id,
          );
        return this.metadata(id);
      })();
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
      logPage: storage.logPage.bind(storage),
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
