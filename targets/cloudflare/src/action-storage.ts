import type { D1PreparedStatement, D1Result } from '@cloudflare/workers-types';
import {
  ActionError,
  type ActionReceipt,
  type ActionRequest,
} from '../../../packages/core/src/actions.js';
import type { AsyncActionStoragePort } from '../../../packages/core/src/async-actions-service.js';
import {
  actionArgumentPlan,
  actionArguments,
  actionRequestKey,
  actionReceipt,
  actionUndoMs,
  tokenWriteKinds,
  type StoredAction,
} from '../../../packages/core/src/action-records.js';
import type { ClockPort, RegexPort } from '../../../packages/core/src/ports.js';
import type { ReadActionTarget } from '../../../packages/core/src/read-actions.js';
import { validateRuleDraft } from '../../../packages/core/src/rule-validation.js';
import { copiedRuleDraft, ruleCopySource } from '../../../packages/core/src/rule-copy.js';
import type { RuleDraft } from '../../../packages/core/src/types/rules.js';
import { AsyncRulesService } from '../../../packages/core/src/async-rules-service.js';
import { ruleRecord } from '../../../packages/db/src/rule-queries.js';
import { quoteJournalName as quote } from '../../../packages/db/src/action-journal.js';
import { CloudflareStorage } from './storage.js';
import { CloudflareActionJournal, type JournalSql } from './action-journal.js';
import { CloudflareReadActions, cloudflareSha256 } from './read-actions.js';
import { CloudflareOpml } from './opml-service.js';
import { CloudflareFeeds } from './feed-service.js';
import { CloudflareNewsletterLibrary } from './newsletter-library.js';
import { CloudflareArticles } from './article-service.js';
import { CloudflareRuleStorage } from './rule-storage.js';

type Raw = Record<string, string | number | null>;
interface LocalPlan {
  queries: JournalSql[];
  valid?: JournalSql;
  result: Record<string, unknown>;
  targetTable?: string;
  clearEmpty?: boolean;
  opmlTotal?: number;
  unchangedSummary?: string;
}
type Options = {
  clock: ClockPort;
  fetcher: typeof fetch;
  regex: RegexPort;
  notify: (article: { id: number; title: string; url: string }) => Promise<void> | void;
};
const leaseMs = 15000;
const revision: JournalSql = {
  sql: "INSERT INTO settings(key,value) VALUES('library_revision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1",
};
const conjunction = (guards: JournalSql[]): JournalSql => ({
  sql: guards.map((guard) => `(${guard.sql})`).join(' AND ') || '1',
  values: guards.flatMap((guard) => guard.values ?? []),
});
const rawGuard = (table: string, row: Raw): JournalSql => ({
  sql: `EXISTS(SELECT 1 FROM ${quote(table)} WHERE ${Object.keys(row)
    .map((key) => `${quote(key)} IS ?`)
    .join(' AND ')})`,
  values: Object.values(row),
});
function ruleFromRaw(row: Raw) {
  return ruleRecord({
    id: Number(row.id),
    name: String(row.name),
    enabled: Number(row.enabled),
    position: Number(row.position),
    matchType: row.match_type as 'all' | 'any',
    scopeJson: String(row.scope_json),
    conditionsJson: String(row.conditions_json),
    actionsJson: String(row.actions_json),
    stopProcessing: Number(row.stop_processing),
  });
}
function ruleInsert(draft: RuleDraft): JournalSql {
  validateRuleDraft(draft);
  return {
    sql: 'INSERT INTO rules(name,enabled,position,match_type,scope_json,conditions_json,actions_json,stop_processing) SELECT ?,?,coalesce(?,coalesce(max(position),-1)+1),?,?,?,?,? FROM rules',
    values: [
      draft.name.trim(),
      Number(draft.enabled),
      draft.position ?? null,
      draft.matchType,
      JSON.stringify(draft.scope),
      JSON.stringify(draft.conditions),
      JSON.stringify(draft.actions),
      Number(draft.stopProcessing),
    ],
  };
}

export class CloudflareActionStorage implements AsyncActionStoragePort {
  private journal: CloudflareActionJournal;
  private reads: CloudflareReadActions;
  private tasks = new Set<Promise<ActionReceipt>>();
  constructor(
    private storage: CloudflareStorage,
    private options: Options,
  ) {
    this.journal = new CloudflareActionJournal(storage);
    this.reads = new CloudflareReadActions(storage, () => options.clock.now());
  }
  private at() {
    return this.options.clock.now().getTime();
  }
  private authorized(
    request: Pick<ActionRequest, 'tokenId' | 'actor' | 'readerGeneration'>,
  ): JournalSql {
    const guards: JournalSql[] = [];
    if (request.tokenId !== undefined)
      guards.push({
        sql: "EXISTS(SELECT 1 FROM api_tokens WHERE id=? AND scopes='write' AND expires_at>?)",
        values: [request.tokenId, this.at()],
      });
    if (request.actor === 'reader')
      guards.push({
        sql: 'EXISTS(SELECT 1 FROM reader_access WHERE id=1 AND generation=?)',
        values: [request.readerGeneration ?? ''],
      });
    return conjunction(guards);
  }
  private async authorize(
    request: Pick<ActionRequest, 'tokenId' | 'actor' | 'readerGeneration'> & {
      kind?: string;
      signal?: AbortSignal;
    },
  ) {
    if (request.signal?.aborted)
      throw new ActionError(409, 'The tool was cancelled before writing.');
    if (request.tokenId !== undefined && request.kind && !tokenWriteKinds.includes(request.kind))
      throw new ActionError(
        403,
        'Tokens can mark, star, tag and add feeds. Review other changes in Brew.',
      );
    const guard = this.authorized(request);
    if (!(await this.storage.first(`SELECT 1 WHERE ${guard.sql}`, guard.values)))
      throw new ActionError(
        403,
        request.actor === 'reader'
          ? 'Reader access has changed. Sign in again.'
          : 'This token cannot write.',
      );
    if (request.signal?.aborted)
      throw new ActionError(409, 'The tool was cancelled before writing.');
  }
  async receipt(id: number): Promise<ActionReceipt> {
    const row = await this.storage.first<StoredAction>('SELECT * FROM agent_actions WHERE id=?', [
      id,
    ]);
    if (!row) throw new ActionError(404, 'Action not found.');
    return this.mapReceipt(row);
  }
  private mapReceipt(row: StoredAction) {
    const result = JSON.parse(row.result_json) as { status: string; _lease?: { until: number } };
    return actionReceipt(
      row,
      this.at(),
      result.status === 'pending' && (result._lease?.until ?? 0) > this.at(),
    );
  }
  async previewRead(target: ReadActionTarget) {
    return (await this.reads.inspect(target)).preview;
  }
  run(request: ActionRequest) {
    const task = this.execute(request).finally(() => this.tasks.delete(task));
    this.tasks.add(task);
    return task;
  }
  private async prior(key: string, request: ActionRequest, args: string) {
    const row = await this.storage.first<StoredAction>(
      'SELECT * FROM agent_actions WHERE request_id=?',
      [key],
    );
    if (!row) return null;
    if (row.tool !== request.kind || row.args_json !== args)
      throw new ActionError(409, 'This request was already used for another action.');
    return this.mapReceipt(row);
  }
  private record(
    request: ActionRequest,
    key: string,
    args: string,
    result: Record<string, unknown>,
  ): JournalSql {
    const at = this.at();
    return {
      sql: 'INSERT INTO agent_actions(agent,token_id,request_id,tool,args_json,result_json,undo_json,created_at) VALUES(?,?,?,?,?,?,?,?)',
      values: [
        request.agentName ?? request.actor ?? 'web',
        request.tokenId ?? null,
        key,
        request.kind,
        args,
        JSON.stringify(result),
        JSON.stringify({ version: 1, expiresAt: at + actionUndoMs }),
        at,
      ],
    };
  }
  private async execute(request: ActionRequest) {
    await this.authorize(request);
    await this.cleanup();
    const fingerprint = actionArgumentPlan(request),
      args = actionArguments(
        fingerprint,
        fingerprint.value === undefined ? undefined : await cloudflareSha256(fingerprint.value),
      );
    const key = actionRequestKey(request) ?? `internal:${crypto.randomUUID()}`;
    if (request.requestId) {
      const prior = await this.prior(key, request, args);
      if (prior) return prior;
    }
    try {
      if (request.kind === 'apply_rule') return await this.applyRule(request, key, args);
      const plan = await this.plan(request);
      await this.authorize(request);
      const actionId: JournalSql = {
        sql: '(SELECT id FROM agent_actions WHERE request_id=?)',
        values: [key],
      };
      let resultSql = '?',
        resultValues: unknown[] = [JSON.stringify(plan.result)];
      if (plan.targetTable) {
        resultSql = `json_set(?,'$.targetId',(SELECT json_extract(key_json,'$.id') FROM agent_action_changes WHERE action_id=${actionId.sql} AND table_name=? AND before_json IS NULL ORDER BY id DESC LIMIT 1))`;
        resultValues = [...resultValues, key, plan.targetTable];
      }
      if (plan.unchangedSummary) {
        resultSql = `json_set(${resultSql},'$.summary',CASE WHEN EXISTS(SELECT 1 FROM agent_action_changes WHERE action_id=${actionId.sql}) THEN ? ELSE ? END)`;
        resultValues.push(key, plan.result.summary, plan.unchangedSummary);
      }
      if (plan.opmlTotal !== undefined) {
        const counts = `SELECT count(CASE WHEN table_name='feeds' THEN 1 END) AS imported,count(CASE WHEN table_name='folders' THEN 1 END) AS foldersCreated FROM agent_action_changes WHERE action_id=${actionId.sql} AND before_json IS NULL`;
        resultSql = `(SELECT json_object('kind','import_opml','targetId',NULL,'summary','Imported '||imported||' '||CASE WHEN imported=1 THEN 'feed' ELSE 'feeds' END||'; skipped '||CAST(?-imported AS INTEGER)||' existing or duplicate '||CASE WHEN ?-imported=1 THEN 'feed' ELSE 'feeds' END||'; created '||foldersCreated||' '||CASE WHEN foldersCreated=1 THEN 'folder' ELSE 'folders' END||'.','status','complete','externalEffects',json('false'),'imported',imported,'skipped',?-imported,'foldersCreated',foldersCreated) FROM (${counts}))`;
        resultValues = [plan.opmlTotal, plan.opmlTotal, plan.opmlTotal, key];
      }
      const noUndo = plan.clearEmpty
        ? `CASE WHEN EXISTS(SELECT 1 FROM agent_action_changes WHERE action_id=${actionId.sql}) THEN undo_json ELSE NULL END`
        : 'undo_json';
      if (request.signal?.aborted)
        throw new ActionError(409, 'The tool was cancelled before writing.');
      await this.journal.transaction({
        actionId,
        at: this.at(),
        authorized: this.authorized(request),
        valid: plan.valid,
        before: [this.record(request, key, args, { ...plan.result, status: 'pending' })],
        queries: plan.queries,
        after: [
          {
            sql: `UPDATE agent_actions SET result_json=${resultSql},undo_json=${noUndo} WHERE request_id=?`,
            values: [...resultValues, ...(plan.clearEmpty ? [key] : []), key],
          },
        ],
      });
      return (await this.prior(key, request, args))!;
    } catch (error) {
      const existing = await this.prior(key, request, args);
      if (existing) return existing;
      throw error;
    }
  }
  private async plan(request: Exclude<ActionRequest, { kind: 'apply_rule' }>): Promise<LocalPlan> {
    const result: Record<string, unknown> = {
      kind: request.kind,
      targetId: 'id' in request ? request.id : null,
      summary: '',
      status: 'complete',
      externalEffects: false,
    };
    if (request.kind === 'mark_read') {
      const plan = await this.reads.inspect(request.target);
      if (plan.preview.revision !== request.revision)
        throw new ActionError(
          409,
          'The unread articles changed. Close this confirmation and review the scope again.',
        );
      return {
        result: { ...result, summary: `Marked ${plan.ids.length} read.`, updated: plan.ids.length },
        clearEmpty: true,
        valid: plan.valid,
        queries: [
          {
            sql: 'UPDATE articles SET read_at=? WHERE read_at IS NULL AND id IN(SELECT value FROM json_each(?))',
            values: [this.at(), JSON.stringify(plan.ids)],
          },
          revision,
        ],
      };
    }
    if (request.kind === 'update_sender') {
      const library = new CloudflareNewsletterLibrary(
        this.storage,
        new CloudflareArticles(this.storage, this.options.fetcher, () => this.options.clock.now()),
        () => this.options.clock.now(),
      );
      let plan;
      try {
        plan = await library.prepareUpdate(request.id, request.patch);
      } catch (error) {
        throw new ActionError(400, (error as Error).message);
      }
      if (!plan) throw new ActionError(404, 'Sender not found.');
      const preview = plan.review;
      if (preview.revision !== request.revision)
        throw new ActionError(
          409,
          'The sender or affected content changed. Close this confirmation and review the settings again.',
        );
      return {
        queries: plan.queries,
        valid: plan.valid,
        clearEmpty: true,
        unchangedSummary: 'Sender settings were already current.',
        result: {
          ...result,
          summary: `Saved settings for “${preview.senderTitle}”.${preview.lettersRemoved || preview.originalsRemoved ? ` Removed ${preview.lettersRemoved} letters; cleared ${preview.originalsRemoved} originals.` : ''}`,
          lettersRemoved: preview.lettersRemoved,
          originalsRemoved: preview.originalsRemoved,
        },
      };
    }
    if (request.kind === 'import_opml') {
      let plan;
      try {
        plan = new CloudflareOpml(this.storage).importPlan(request.opml);
      } catch {
        throw new ActionError(400, 'Invalid OPML document. Check the file and its feed URLs.');
      }
      return { queries: plan.queries, result, clearEmpty: true, opmlTotal: plan.total };
    }
    if (request.kind === 'add_feed') {
      const prepared = await new CloudflareFeeds(this.storage, this.options.fetcher).prepareAdd(
          request.url,
          request.folderId,
        ),
        { candidate, metadata } = prepared.result;
      if (
        request.folderId !== null &&
        !(await this.storage.first('SELECT id FROM folders WHERE id=?', [request.folderId]))
      )
        throw new Error('Folder not found');
      return {
        result: { ...result, summary: 'Subscribed to feed.' },
        targetTable: 'feeds',
        valid:
          request.folderId === null
            ? undefined
            : { sql: 'EXISTS(SELECT 1 FROM folders WHERE id=?)', values: [request.folderId] },
        queries: [
          {
            sql: 'INSERT INTO feeds(url,title,description,site_url,folder_id) VALUES(?,?,?,?,?)',
            values: [
              candidate.url,
              metadata.title,
              metadata.description,
              metadata.siteUrl,
              request.folderId,
            ],
          },
          revision,
        ],
      };
    }
    if (request.kind === 'create_rule')
      return {
        result: { ...result, summary: 'Created rule without running its actions.' },
        targetTable: 'rules',
        queries: [ruleInsert(request.draft), revision],
      };
    if (request.kind === 'star_item' || request.kind === 'tag_item') {
      if (!(await this.storage.first('SELECT id FROM articles WHERE id=?', [request.id])))
        throw new ActionError(404, 'Article not found.');
      const valid = { sql: 'EXISTS(SELECT 1 FROM articles WHERE id=?)', values: [request.id] };
      if (request.kind === 'star_item')
        return {
          valid,
          result: { ...result, summary: 'Updated starred state.' },
          queries: [
            {
              sql: 'UPDATE articles SET starred_at=? WHERE id=?',
              values: [request.starred ? this.at() : null, request.id],
            },
            revision,
          ],
        };
      return {
        valid,
        result: { ...result, summary: 'Updated article tags.' },
        queries: [
          {
            sql: "INSERT OR IGNORE INTO tags(name,color) SELECT value,'#b45309' FROM json_each(?)",
            values: [JSON.stringify(request.add)],
          },
          {
            sql: 'DELETE FROM article_tags WHERE article_id=? AND tag_id IN(SELECT id FROM tags WHERE name IN(SELECT value FROM json_each(?)))',
            values: [request.id, JSON.stringify(request.remove)],
          },
          {
            sql: 'INSERT OR IGNORE INTO article_tags(article_id,tag_id) SELECT ?,id FROM tags WHERE name IN(SELECT value FROM json_each(?))',
            values: [request.id, JSON.stringify(request.add)],
          },
          revision,
        ],
      };
    }
    const table =
      request.kind === 'delete_feed'
        ? 'feeds'
        : request.kind === 'delete_folder'
          ? 'folders'
          : 'rules';
    const row = await this.storage.first<Raw>(`SELECT * FROM ${table} WHERE id=?`, [request.id]);
    if (!row)
      throw new ActionError(
        404,
        request.kind === 'copy_rule' ? 'Rule not found.' : 'Item not found.',
      );
    if (request.kind === 'copy_rule') {
      const source = ruleFromRaw(row);
      if (ruleCopySource(source) !== request.definition)
        throw new ActionError(
          409,
          'The saved rule changed. Close this result, refresh rules and choose Copy again.',
        );
      let query;
      try {
        query = ruleInsert(copiedRuleDraft(source));
      } catch {
        throw new ActionError(400, 'Could not copy this saved rule. Check its definition.');
      }
      return {
        valid: rawGuard(table, row),
        queries: [query, revision],
        targetTable: 'rules',
        result: { ...result, summary: `Copied “${source.name}” as a disabled rule.` },
      };
    }
    return {
      valid: rawGuard(table, row),
      queries: [{ sql: `DELETE FROM ${table} WHERE id=?`, values: [request.id] }, revision],
      result: { ...result, summary: `Deleted ${row.title ?? row.name ?? 'item'}.` },
    };
  }
  private async applyRule(
    request: ActionRequest & { kind: 'apply_rule' },
    key: string,
    args: string,
  ) {
    const row = await this.storage.first<Raw>('SELECT * FROM rules WHERE id=?', [request.id]);
    if (!row) throw new ActionError(404, 'Item not found.');
    const title = row.name ?? 'item',
      external = (JSON.parse(String(row.actions_json)) as Array<{ type: string }>).some((action) =>
        ['webhook', 'notify'].includes(action.type),
      );
    const runner = crypto.randomUUID(),
      initial = {
        kind: request.kind,
        targetId: request.id,
        summary: `Applying ${title}…`,
        status: 'pending',
        externalEffects: external,
        _lease: { runner, until: this.at() + leaseMs },
      };
    if (request.signal?.aborted)
      throw new ActionError(409, 'The tool was cancelled before writing.');
    await this.journal.transaction({
      actionId: { sql: '(SELECT id FROM agent_actions WHERE request_id=?)', values: [key] },
      at: this.at(),
      authorized: this.authorized(request),
      valid: rawGuard('rules', row),
      before: [this.record(request, key, args, initial)],
      queries: [],
    });
    const id = (await this.storage.first<{ id: number }>(
      'SELECT id FROM agent_actions WHERE request_id=?',
      [key],
    ))!.id;
    const active: JournalSql = {
      sql: "EXISTS(SELECT 1 FROM agent_actions WHERE id=? AND undone_at IS NULL AND undo_json IS NOT NULL AND json_extract(result_json,'$.status')='pending' AND json_extract(result_json,'$._lease.runner')=?)",
      values: [id, runner],
    };
    const base = this.storage,
      metadata = new WeakMap<D1PreparedStatement, JournalSql>();
    const recordBatch = (queries: JournalSql[]) =>
      this.journal.transaction({
        actionId: id,
        at: this.at(),
        authorized: this.authorized(request),
        valid: active,
        queries,
        after: [
          {
            sql: "UPDATE agent_actions SET result_json=json_set(result_json,'$._lease.until',?) WHERE id=?",
            values: [this.at() + leaseMs, id],
          },
        ],
      });
    class RecordedStorage extends CloudflareStorage {
      override statement(sql: string, values: unknown[] = []) {
        const statement = base.statement(sql, values);
        metadata.set(statement, { sql, values });
        return statement;
      }
      override async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]) {
        const queries = statements.map((statement) => metadata.get(statement)!);
        if (!queries.some((query) => /^\s*(INSERT|UPDATE|DELETE)/i.test(query.sql)))
          return base.batch<T>(statements);
        const result = await recordBatch(queries);
        return result as unknown as D1Result<T>[];
      }
    }
    // Reuse the real rule adapter and shared executor; only its atomic write batches
    // gain journal activation. Network work never holds the database flag.
    const recorded = new RecordedStorage(this.storage.database);
    const ruleStorage = new CloudflareRuleStorage(recorded);
    let failures = 0;
    const log = ruleStorage.log.bind(ruleStorage);
    ruleStorage.log = async (...values) => {
      failures += values[2].filter((value) => !value.ok).length;
      await log(...values);
    };
    const renew = () =>
      this.journal.transaction({
        actionId: null,
        at: this.at(),
        authorized: this.authorized(request),
        valid: active,
        queries: [
          {
            sql: "UPDATE agent_actions SET result_json=json_set(result_json,'$._lease.until',?),undo_json=json_set(undo_json,'$.expiresAt',?) WHERE id=?",
            values: [this.at() + leaseMs, this.at() + actionUndoMs, id],
          },
        ],
      });
    const network: typeof fetch = async (input, init) => {
      await renew();
      return this.options.fetcher(input, init);
    };
    const notify: Options['notify'] = async (article) => {
      await renew();
      await this.options.notify(article);
    };
    let result: Record<string, unknown>;
    try {
      const rules = new AsyncRulesService(
        ruleStorage,
        this.options.regex,
        { fetch: network },
        { notify },
        this.options.clock,
      );
      const matched = await rules.applyToExisting(request.id, request.days ?? 30);
      result = {
        kind: request.kind,
        targetId: request.id,
        summary: `Applied to ${matched} existing article${matched === 1 ? '' : 's'}.${failures ? ` ${failures} action${failures === 1 ? '' : 's'} failed. Undo can restore local changes.` : ''}`,
        status: failures ? 'failed' : 'complete',
        externalEffects: external,
        matched,
        failedActions: failures,
      };
    } catch {
      result = {
        kind: request.kind,
        targetId: request.id,
        summary: 'Could not finish applying the rule. Undo can restore local changes.',
        status: 'failed',
        externalEffects: external,
      };
    }
    await this.journal.transaction({
      actionId: null,
      at: this.at(),
      authorized: this.authorized(request),
      valid: active,
      queries: [
        {
          sql: 'UPDATE agent_actions SET result_json=?,undo_json=? WHERE id=?',
          values: [
            JSON.stringify(result),
            JSON.stringify({ version: 1, expiresAt: this.at() + actionUndoMs }),
            id,
          ],
        },
      ],
    });
    return this.receipt(id);
  }
  async undo(id: number, tokenId?: number) {
    await this.authorize({ tokenId });
    if (
      tokenId !== undefined &&
      !(await this.storage.first('SELECT id FROM agent_actions WHERE id=? AND token_id=?', [
        id,
        tokenId,
      ]))
    )
      throw new ActionError(404, 'Action not found.');
    await this.cleanup();
    const receipt = await this.receipt(id);
    if (receipt.status === 'undone') return receipt;
    const raw = (await this.storage.first<StoredAction>('SELECT * FROM agent_actions WHERE id=?', [
      id,
    ]))!;
    if (JSON.parse(raw.result_json)._lease?.until > this.at() && receipt.status === 'pending')
      throw new ActionError(409, 'Wait for the action to finish.');
    if (!receipt.canUndo) throw new ActionError(410, 'The Undo window has expired.');
    try {
      await this.journal.restore(id, this.at(), {
        authorized: conjunction([
          this.authorized({ tokenId }),
          ...(tokenId === undefined
            ? []
            : [
                {
                  sql: 'EXISTS(SELECT 1 FROM agent_actions WHERE id=? AND token_id=?)',
                  values: [id, tokenId],
                },
              ]),
        ]),
        valid: {
          sql: "EXISTS(SELECT 1 FROM agent_actions WHERE id=? AND undone_at IS NULL AND undo_json IS ? AND result_json IS ? AND json_extract(undo_json,'$.expiresAt')>?)",
          values: [id, raw.undo_json, raw.result_json, this.at()],
        },
        after: [
          {
            sql: 'UPDATE agent_actions SET undone_at=?,undo_json=NULL WHERE id=?',
            values: [this.at(), id],
          },
          { sql: 'DELETE FROM agent_action_changes WHERE action_id=?', values: [id] },
          revision,
        ],
      });
    } catch (error) {
      const current = await this.receipt(id);
      if (current.status === 'undone') return current;
      throw error;
    }
    return this.receipt(id);
  }
  async recent() {
    await this.cleanup();
    return (
      await this.storage.all<StoredAction>(
        "SELECT * FROM agent_actions WHERE undo_json IS NOT NULL OR json_type(result_json,'$.kind') IS NOT NULL ORDER BY id DESC LIMIT 20",
      )
    ).map((row) => this.mapReceipt(row));
  }
  async cleanup() {
    const at = this.at(),
      expired =
        "undo_json IS NOT NULL AND json_extract(undo_json,'$.expiresAt')<=? AND NOT (json_extract(result_json,'$.status')='pending' AND coalesce(json_extract(result_json,'$._lease.until'),0)>?)";
    await this.storage.batch([
      this.storage.statement(
        `DELETE FROM agent_action_changes WHERE action_id IN(SELECT id FROM agent_actions WHERE ${expired})`,
        [at, at],
      ),
      this.storage.statement(`UPDATE agent_actions SET undo_json=NULL WHERE ${expired}`, [at, at]),
    ]);
  }
  async drain() {
    await Promise.allSettled([...this.tasks]);
  }
}
