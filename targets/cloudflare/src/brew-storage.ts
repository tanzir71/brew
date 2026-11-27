import {
  renderBrewJson,
  renderBrewMarkdownParts,
} from '../../../packages/core/src/brew-outputs.js';
import {
  upgradeLegacyDraft,
  scheduleCron,
  BREW_RETENTION_DAYS,
} from '../../../packages/core/src/composition-model.js';
import type {
  AsyncBrewStoragePort,
  BrewStoragePort,
  BrewItemQuery,
  BrewItemRow,
} from '../../../packages/core/src/ports.js';
import type { BrewConfigDraft } from '../../../packages/core/src/types/legacy-brew.js';
import type {
  BrewConfigDraft as CompositionDraft,
  BrewIssue,
  BrewSnapshot,
} from '../../../packages/core/src/types/brew.js';
import type { BrewDeliveryResults } from '../../../packages/core/src/types/delivery.js';
import {
  legacyBrewConfig,
  brewComposition,
  compositionItemsQuery,
  brewCandidates,
  legacyBrewItemsQuery,
  brewArticleStates,
  type BrewConfigRow,
  type BrewCandidateRow,
  type BrewArticleStateRow,
  type BrewRuleLogRow,
} from '../../../packages/db/src/brew-queries.js';
import { CloudflareStorage } from './storage.js';
import { libraryRevision } from './events.js';
import {
  scheduledConfig,
  scheduleFence,
  clearScheduleFence,
} from '../../../packages/db/src/brew-scheduled-queries.js';
import type {
  ScheduledBrewJob,
  ScheduledPayload,
} from '../../../packages/core/src/brew-scheduled-processing.js';

const configColumns = `id,name,schedule_cron AS scheduleCron,enabled,sections_json AS sectionsJson,
  timezone,schedule_json AS scheduleJson,delivery_json AS deliveryJson,legacy_sections_json AS legacySectionsJson,
  composition_version AS compositionVersion,created_at AS createdAt`;
// Counter and retained history are read inside the same transaction that inserts
// the issue. A preview's proposed number is never trusted during a freeze.
const lastNumber = `max(coalesce((SELECT CASE WHEN json_valid(value) THEN
  CASE WHEN json_type(value) IN ('integer','real') AND CAST(value AS REAL) BETWEEN 0 AND 9007199254740991
    AND CAST(value AS REAL)=CAST(CAST(value AS REAL) AS INTEGER) THEN CAST(CAST(value AS REAL) AS INTEGER) ELSE 0 END
  ELSE 0 END FROM settings WHERE key=?),0),coalesce((SELECT max(issue_number) FROM brews WHERE brew_config_id=?),0))`;
type Payload = Parameters<BrewStoragePort['save']>[1];

export class CloudflareBrewStorage implements AsyncBrewStoragePort {
  private scheduleRows?: ReadonlyMap<number, BrewConfigRow>;
  constructor(
    private storage: CloudflareStorage,
    private timezone = 'UTC',
  ) {}
  /** Cron-only snapshot; never cache mutable configuration across invocations. */
  static async scheduled(storage: CloudflareStorage, now: Date) {
    const before = now.getTime() - BREW_RETENTION_DAYS * 86_400_000;
    if (!Number.isFinite(before)) throw new Error('Invalid Brew maintenance time.');
    const reads = await storage.batch([
      storage.statement(`SELECT ${configColumns} FROM brew_configs ORDER BY id`),
      storage.statement(
        `SELECT b.id,b.brew_config_id AS configId FROM brews b JOIN brew_configs c ON c.id=b.brew_config_id
         WHERE c.composition_version=2 AND b.generated_at<? ORDER BY b.generated_at,b.id LIMIT 500`,
        [before],
      ),
    ]);
    const expired = reads[1]!.results as unknown as { id: number; configId: number }[];
    if (expired.length) {
      const counters = [...new Set(expired.map((issue) => issue.configId))].map((configId) => {
        const key = `brew_issue_number_${configId}`;
        return storage.statement(
          `INSERT INTO settings(key,value) SELECT ?,CAST(n AS TEXT) FROM (SELECT ${lastNumber} AS n)
           WHERE n>0 AND EXISTS(SELECT 1 FROM brew_configs WHERE id=? AND composition_version=2)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
          [key, key, configId, configId],
        );
      });
      await storage.batch([
        ...counters,
        storage.statement(
          `DELETE FROM brews WHERE id IN (SELECT value FROM json_each(?)) AND generated_at<?
           AND EXISTS(SELECT 1 FROM brew_configs WHERE id=brews.brew_config_id AND composition_version=2)`,
          [JSON.stringify(expired.map((issue) => issue.id)), before],
        ),
      ]);
    }
    const scoped = new CloudflareBrewStorage(storage);
    scoped.scheduleRows = new Map(
      (reads[0]!.results as unknown as BrewConfigRow[]).map((row) => [row.id, row]),
    );
    return scoped;
  }
  async listConfigs() {
    const rows = this.scheduleRows
      ? [...this.scheduleRows.values()]
      : await this.storage.all<BrewConfigRow>(`SELECT ${configColumns} FROM brew_configs`);
    return rows.map(legacyBrewConfig);
  }
  async scheduledConfigs() {
    const rows = this.scheduleRows
      ? [...this.scheduleRows.values()]
      : await this.storage.all<BrewConfigRow>(
          `SELECT ${configColumns} FROM brew_configs ORDER BY id`,
        );
    return rows.map(scheduledConfig);
  }
  withScheduledStorage(storage: CloudflareStorage) {
    const scoped = new CloudflareBrewStorage(storage, this.timezone);
    scoped.scheduleRows = this.scheduleRows;
    return scoped;
  }
  private async writeConfig(draft: CompositionDraft, legacy?: BrewConfigDraft, id?: number) {
    const previous = id === undefined ? null : await this.composition(id);
    const cron =
      legacy?.scheduleCron ??
      (previous && JSON.stringify(previous.schedule) === JSON.stringify(draft.schedule)
        ? previous.scheduleCron
        : scheduleCron(draft.schedule));
    const values = [
      draft.name.trim(),
      draft.enabled ? 1 : 0,
      JSON.stringify(draft.sections),
      legacy ? JSON.stringify(legacy.sections) : null,
      draft.timezone,
      JSON.stringify(draft.schedule),
      JSON.stringify(draft.delivery),
      cron,
      legacy ? 1 : 2,
    ];
    const result = await this.storage.batch([
      id === undefined
        ? this.storage.statement(
            `INSERT INTO brew_configs(name,enabled,sections_json,legacy_sections_json,timezone,schedule_json,delivery_json,schedule_cron,composition_version) VALUES(?,?,?,?,?,?,?,?,?) RETURNING id`,
            values,
          )
        : this.storage.statement(
            `UPDATE brew_configs SET name=?,enabled=?,sections_json=?,legacy_sections_json=?,timezone=?,schedule_json=?,delivery_json=?,schedule_cron=?,composition_version=? WHERE id=? RETURNING id`,
            [...values, id],
          ),
      libraryRevision(this.storage),
    ]);
    return (result[0]!.results[0]?.id as number | undefined) ?? null;
  }
  async create(draft: BrewConfigDraft) {
    return (await this.writeConfig(upgradeLegacyDraft(draft, this.timezone), draft))!;
  }
  async update(id: number, draft: BrewConfigDraft) {
    return (await this.writeConfig(upgradeLegacyDraft(draft, this.timezone), draft, id)) !== null;
  }
  async delete(id: number) {
    const result = await this.storage.batch([
      this.storage.statement(
        `UPDATE feeds SET settings_json=json_set(json_remove(settings_json,'$.brewId'),'$.onlyInBrew',json('false'))
        WHERE kind='newsletter' AND json_extract(settings_json,'$.brewId')=? AND EXISTS(SELECT 1 FROM brew_configs WHERE id=?)`,
        [id, id],
      ),
      this.storage.statement('DELETE FROM brew_configs WHERE id=? RETURNING id', [id]),
      libraryRevision(this.storage),
    ]);
    return result[1]!.results.length > 0;
  }
  async items(query: BrewItemQuery) {
    const built = legacyBrewItemsQuery(query);
    return this.storage.all<BrewItemRow>(built.sql, built.values);
  }
  async save(configId: number, payload: Payload) {
    return (await this.freeze(configId, payload))!;
  }
  async saveScheduled(configId: number, payload: Payload, receipt: { key: string; value: string }) {
    return this.freeze(configId, payload, receipt);
  }
  async saveScheduledWork(
    job: ScheduledBrewJob,
    payload: ScheduledPayload,
    now: number,
    until: number,
  ) {
    return this.freeze(job.request.config.id, payload, job.request.receipt, { job, now, until });
  }
  private async freeze(
    configId: number,
    payload: Payload,
    receipt?: { key: string; value: string },
    work?: { job: ScheduledBrewJob; now: number; until: number },
  ) {
    const counter = `brew_issue_number_${configId}`;
    const guard = receipt ? 'NOT EXISTS(SELECT 1 FROM settings WHERE key=?)' : '1=1';
    const guardValues = receipt ? [receipt.key] : [];
    const number = '(SELECT CAST(value AS INTEGER) FROM settings WHERE key=?)';
    const modern = 'version' in payload;
    const fence = work ? scheduleFence(work.job, work.now) : undefined;
    const statements = [
      ...(fence ? [this.storage.statement(fence.sql, fence.values)] : []),
      this.storage.statement(
        `INSERT INTO settings(key,value) SELECT ?,CAST(${lastNumber}+1 AS TEXT) WHERE ${guard}
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        [counter, counter, configId, ...guardValues],
      ),
      this.storage.statement(
        `INSERT INTO brews(brew_config_id,payload_json,issue_number,generated_at)
        SELECT ?,${modern ? `json_set(?,'$.issueNumber',${number})` : '?'},${number},? WHERE ${guard} RETURNING id`,
        [
          configId,
          JSON.stringify(payload),
          ...(modern ? [counter] : []),
          counter,
          modern
            ? new Date(payload.generatedAt).getTime()
            : work
              ? new Date(work.job.request.receipt.value).getTime()
              : Date.now(),
          ...guardValues,
        ],
      ),
    ];
    if (modern) {
      const template: BrewSnapshot = {
        ...payload,
        id: 0,
        brewConfigId: configId,
        scrollPosition: 0,
      };
      const [before, after] = renderBrewMarkdownParts(template);
      // Assign the cache's id/number from the inserted row, inside this batch.
      // User content is bound verbatim, never searched/replaced for placeholders.
      statements.push(
        this.storage.statement(
          `UPDATE brews SET rendered_md=? || issue_number || ?,
        rendered_json=json_set(?,'$.id',id,'$.issueNumber',issue_number) || char(10)
        WHERE brew_config_id=? AND issue_number=${number} AND ${guard}`,
          [before, after, renderBrewJson(template), configId, counter, ...guardValues],
        ),
      );
    }
    if (work) {
      if (work.job.request.kind === 'composition')
        statements.push(
          this.storage.statement(
            `UPDATE brew_schedule_jobs SET state_json=json_object('phase','delivery','issueId',
          (SELECT id FROM brews WHERE brew_config_id=? AND issue_number=${number}),'started',json('false')),
          version=version+1,expires_at=? WHERE id=? AND ${guard}`,
            [configId, counter, work.until, work.job.id, ...guardValues],
          ),
          this.storage.statement(`DELETE FROM brew_schedule_jobs WHERE id=? AND NOT (${guard})`, [
            work.job.id,
            ...guardValues,
          ]),
        );
      else
        statements.push(
          this.storage.statement('DELETE FROM brew_schedule_jobs WHERE id=?', [work.job.id]),
          this.storage.statement(
            `DELETE FROM brews WHERE id IN (SELECT id FROM brews WHERE brew_config_id=? ORDER BY generated_at DESC,id DESC LIMIT -1 OFFSET 30) AND ${guard}`,
            [configId, ...guardValues],
          ),
        );
    }
    if (receipt)
      statements.push(
        this.storage.statement('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)', [
          receipt.key,
          receipt.value,
        ]),
      );
    if (work) statements.push(this.storage.statement(clearScheduleFence.sql));
    statements.push(libraryRevision(this.storage));
    const result = await this.storage.batch(statements);
    return (result[work ? 2 : 1]!.results[0]?.id as number | undefined) ?? null;
  }
  async prune(configId: number, keep: number) {
    await this.storage.run(
      'DELETE FROM brews WHERE id IN (SELECT id FROM brews WHERE brew_config_id=? ORDER BY generated_at DESC,id DESC LIMIT -1 OFFSET ?)',
      [configId, keep],
    );
  }
  async pruneBefore(configId: number, before: number) {
    // Scheduled setup already performs one bounded global history page. Do not
    // turn the shared per-config policy back into unbounded invocation queries.
    if (this.scheduleRows) return;
    const counter = `brew_issue_number_${configId}`;
    await this.storage.batch([
      this.storage.statement(
        `INSERT INTO settings(key,value) SELECT ?,CAST(n AS TEXT) FROM (SELECT ${lastNumber} AS n) WHERE n>0
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        [counter, counter, configId],
      ),
      this.storage.statement('DELETE FROM brews WHERE brew_config_id=? AND generated_at<?', [
        configId,
        before,
      ]),
    ]);
  }
  async claimSchedule(key: string, value: string) {
    return (
      (
        await this.storage.run('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)', [
          key,
          value,
        ])
      ).meta.changes === 1
    );
  }
  async claimDelivery(id: number, results: BrewDeliveryResults) {
    return (
      (
        await this.storage.run('UPDATE brews SET sent_json=? WHERE id=? AND sent_json IS NULL', [
          JSON.stringify(results),
          id,
        ])
      ).meta.changes === 1
    );
  }
  async saveDelivery(id: number, results: BrewDeliveryResults) {
    await this.storage.run('UPDATE brews SET sent_json=? WHERE id=?', [
      JSON.stringify(results),
      id,
    ]);
  }
  async deliveryResults(id: number): Promise<BrewDeliveryResults | null> {
    const row = await this.storage.first<{ value: string | null }>(
      'SELECT sent_json AS value FROM brews WHERE id=?',
      [id],
    );
    return row?.value ? JSON.parse(row.value) : null;
  }
  async historyIds(configId: number) {
    return (
      await this.storage.all<{ id: number }>(
        'SELECT id FROM brews WHERE brew_config_id=? ORDER BY generated_at DESC,id DESC',
        [configId],
      )
    ).map((row) => row.id);
  }
  async snapshot(id: number): Promise<BrewIssue | null> {
    const row = await this.storage.first<{
      id: number;
      brewConfigId: number;
      generatedAt: number;
      payload: string;
      scroll: string | null;
    }>(
      `SELECT id,brew_config_id AS brewConfigId,generated_at AS generatedAt,payload_json AS payload,
        (SELECT value FROM settings WHERE key='brew_scroll_' || brews.id) AS scroll FROM brews WHERE id=?`,
      [id],
    );
    return row
      ? {
          id: row.id,
          brewConfigId: row.brewConfigId,
          generatedAt: new Date(row.generatedAt).toISOString(),
          scrollPosition: Number(row.scroll ?? 0),
          ...JSON.parse(row.payload),
        }
      : null;
  }
  async composition(id: number) {
    const row = this.scheduleRows
      ? this.scheduleRows.get(id)
      : await this.storage.first<BrewConfigRow>(
          `SELECT ${configColumns} FROM brew_configs WHERE id=?`,
          [id],
        );
    return row ? brewComposition(row) : null;
  }
  async usesComposition(id: number) {
    if (this.scheduleRows) return this.scheduleRows.get(id)?.compositionVersion === 2;
    return (
      (
        await this.storage.first<{ version: number }>(
          'SELECT composition_version AS version FROM brew_configs WHERE id=?',
          [id],
        )
      )?.version === 2
    );
  }
  async createComposition(draft: CompositionDraft) {
    return (await this.writeConfig(draft))!;
  }
  async updateComposition(id: number, draft: CompositionDraft) {
    return (await this.writeConfig(draft, undefined, id)) !== null;
  }
  async nextIssueNumber(id: number) {
    return (await this.storage.first<{ n: number }>(`SELECT ${lastNumber}+1 AS n`, [
      `brew_issue_number_${id}`,
      id,
    ]))!.n;
  }
  async savedSourceSearch(id: number) {
    return (
      (await this.storage.first<{ query: string }>(
        'SELECT query FROM saved_source_searches WHERE id=?',
        [id],
      )) ?? undefined
    );
  }
  async compositionItems(query: BrewItemQuery) {
    const built = compositionItemsQuery(query);
    return built
      ? brewCandidates(await this.storage.all<BrewCandidateRow>(built.sql, built.values))
      : [];
  }
  async articleStates(ids: number[]) {
    if (!ids.length) return [];
    const result = await this.storage.batch([
      this.storage.statement(
        'SELECT id,feed_id AS feedId,read_at AS readAt,starred_at AS starredAt,highlight_color AS highlightColor FROM articles WHERE id IN (SELECT value FROM json_each(?))',
        [JSON.stringify(ids)],
      ),
      this.storage.statement(
        'SELECT l.article_id AS articleId,r.id,r.name,l.actions_taken_json AS actions FROM rule_logs l JOIN rules r ON r.id=l.rule_id WHERE l.article_id IN (SELECT value FROM json_each(?)) ORDER BY l.executed_at DESC,l.id DESC',
        [JSON.stringify(ids)],
      ),
    ]);
    return brewArticleStates(
      ids,
      result[0]!.results as unknown as BrewArticleStateRow[],
      result[1]!.results as unknown as BrewRuleLogRow[],
    );
  }
  async setting(key: string) {
    return (
      await this.storage.first<{ value: string }>('SELECT value FROM settings WHERE key=?', [key])
    )?.value;
  }
  async setSetting(key: string, value: string) {
    await this.storage.run(
      'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      [key, value],
    );
  }
}
