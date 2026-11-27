import {
  legacyBrewConfig,
  brewComposition,
  compositionItemsQuery,
  brewCandidates,
  legacyBrewItemsQuery,
  brewArticleStates,
  type BrewCandidateRow,
} from '../../../../packages/db/src/brew-queries.js';
import { renderBrewJson, renderBrewMarkdown } from '../../../../packages/core/src/brew-outputs.js';
import { desc, eq } from 'drizzle-orm';
import type {
  BrewConfig,
  BrewConfigDraft,
  BrewSnapshot,
  BrewArticleState,
} from '../../../../packages/core/src/types/legacy-brew.js';
import type {
  BrewStoragePort,
  BrewItemQuery,
  BrewItemRow,
} from '../../../../packages/core/src/ports.js';
import type { BrewDatabase } from '../db/database.js';
import { brewConfigs, brews } from '../db/schema.js';
import {
  upgradeLegacyDraft,
  scheduleCron,
} from '../../../../packages/core/src/composition-model.js';
import type {
  BrewConfig as Composition,
  BrewConfigDraft as CompositionDraft,
  BrewIssue,
  BrewSnapshot as ModernSnapshot,
} from '../../../../packages/core/src/types/brew.js';
import type { BrewCandidate } from '../../../../packages/core/src/ports.js';
export class NodeBrewStorage implements BrewStoragePort {
  constructor(private readonly database: BrewDatabase) {}
  listConfigs(): BrewConfig[] {
    return this.database.db.select().from(brewConfigs).all().map(legacyBrewConfig);
  }
  create(draft: BrewConfigDraft): number {
    const value = upgradeLegacyDraft(draft, Intl.DateTimeFormat().resolvedOptions().timeZone);
    return this.database.db
      .insert(brewConfigs)
      .values({
        name: draft.name,
        scheduleCron: draft.scheduleCron,
        enabled: draft.enabled,
        sectionsJson: JSON.stringify(value.sections),
        legacySectionsJson: JSON.stringify(draft.sections),
        timezone: value.timezone,
        scheduleJson: JSON.stringify(value.schedule),
        deliveryJson: JSON.stringify(value.delivery),
      })
      .returning()
      .get().id;
  }
  update(id: number, draft: BrewConfigDraft): boolean {
    const value = upgradeLegacyDraft(draft, Intl.DateTimeFormat().resolvedOptions().timeZone);
    return Boolean(
      this.database.db
        .update(brewConfigs)
        .set({
          name: draft.name,
          scheduleCron: draft.scheduleCron,
          enabled: draft.enabled,
          sectionsJson: JSON.stringify(value.sections),
          legacySectionsJson: JSON.stringify(draft.sections),
          timezone: value.timezone,
          scheduleJson: JSON.stringify(value.schedule),
          deliveryJson: JSON.stringify(value.delivery),
          compositionVersion: 1,
        })
        .where(eq(brewConfigs.id, id))
        .returning()
        .get(),
    );
  }
  delete(id: number): boolean {
    return this.database.sqlite.transaction(() => {
      const deleted =
        this.database.db.delete(brewConfigs).where(eq(brewConfigs.id, id)).run().changes > 0;
      if (deleted)
        this.database.sqlite
          .prepare(
            "UPDATE feeds SET settings_json=json_set(json_remove(settings_json,'$.brewId'),'$.onlyInBrew',json('false')) WHERE kind='newsletter' AND json_extract(settings_json,'$.brewId')=?",
          )
          .run(id);
      return deleted;
    })();
  }
  items(query: BrewItemQuery): BrewItemRow[] {
    const built = legacyBrewItemsQuery(query);
    return this.database.sqlite.prepare(built.sql).all(...built.values) as BrewItemRow[];
  }
  save(
    configId: number,
    payload:
      | Pick<BrewSnapshot, 'configName' | 'sections'>
      | Omit<ModernSnapshot, 'id' | 'brewConfigId' | 'scrollPosition'>,
  ): number {
    return this.database.sqlite.transaction(() => {
      const issueNumber = this.nextIssueNumber(configId);
      const value = 'version' in payload ? { ...payload, issueNumber } : payload;
      this.setSetting(`brew_issue_number_${configId}`, String(issueNumber));
      const row = this.database.db
        .insert(brews)
        .values({
          brewConfigId: configId,
          payloadJson: JSON.stringify(value),
          issueNumber,
          ...('version' in payload ? { generatedAt: new Date(payload.generatedAt) } : {}),
        })
        .returning()
        .get();
      if ('version' in value) {
        const snapshot: ModernSnapshot = {
          ...value,
          id: row.id,
          brewConfigId: configId,
          scrollPosition: 0,
        };
        // Origin-neutral frozen twins travel with the issue. HTTP delivery renders
        // with the current instance origin; a read never backfills old snapshots.
        this.database.db
          .update(brews)
          .set({ renderedMd: renderBrewMarkdown(snapshot), renderedJson: renderBrewJson(snapshot) })
          .where(eq(brews.id, row.id))
          .run();
      }
      return row.id;
    })();
  }

  prune(configId: number, keep: number): void {
    for (const id of this.historyIds(configId).slice(keep))
      this.database.db.delete(brews).where(eq(brews.id, id)).run();
  }
  saveScheduled(
    configId: number,
    payload: Parameters<BrewStoragePort['save']>[1],
    receipt: { key: string; value: string },
  ): number | null {
    return this.database.sqlite.transaction(() => {
      if (!this.claimSchedule(receipt.key, receipt.value)) return null;
      return this.save(configId, payload);
    })();
  }
  claimSchedule(key: string, value: string): boolean {
    return (
      this.database.sqlite
        .prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)')
        .run(key, value).changes === 1
    );
  }
  pruneBefore(configId: number, before: number): void {
    this.database.sqlite.transaction(() => {
      const last = this.nextIssueNumber(configId) - 1;
      const stored = Number(this.setting(`brew_issue_number_${configId}`) ?? 0);
      if (last > 0 && (!Number.isSafeInteger(stored) || last > stored))
        this.setSetting(`brew_issue_number_${configId}`, String(last));
      this.database.sqlite
        .prepare('DELETE FROM brews WHERE brew_config_id=? AND generated_at<?')
        .run(configId, before);
    })();
  }
  claimDelivery(
    id: number,
    results: import('../../../../packages/core/src/types/delivery.js').BrewDeliveryResults,
  ): boolean {
    return (
      this.database.sqlite
        .prepare('UPDATE brews SET sent_json=? WHERE id=? AND sent_json IS NULL')
        .run(JSON.stringify(results), id).changes === 1
    );
  }
  saveDelivery(
    id: number,
    results: import('../../../../packages/core/src/types/delivery.js').BrewDeliveryResults,
  ): void {
    this.database.sqlite
      .prepare('UPDATE brews SET sent_json=? WHERE id=?')
      .run(JSON.stringify(results), id);
  }
  deliveryResults(
    id: number,
  ): import('../../../../packages/core/src/types/delivery.js').BrewDeliveryResults | null {
    const row = this.database.sqlite
      .prepare('SELECT sent_json AS results FROM brews WHERE id=?')
      .get(id) as { results: string | null } | undefined;
    return row?.results ? JSON.parse(row.results) : null;
  }
  historyIds(configId: number): number[] {
    return this.database.db
      .select({ id: brews.id })
      .from(brews)
      .where(eq(brews.brewConfigId, configId))
      .orderBy(desc(brews.generatedAt), desc(brews.id))
      .all()
      .map(({ id }) => id);
  }
  snapshot(id: number): BrewIssue | null {
    const row = this.database.db.select().from(brews).where(eq(brews.id, id)).get();
    if (!row) return null;
    const payload = JSON.parse(row.payloadJson);
    const scroll = (
      this.database.sqlite
        .prepare('SELECT value FROM settings WHERE key=?')
        .get(`brew_scroll_${id}`) as { value: string } | undefined
    )?.value;
    return {
      id: row.id,
      brewConfigId: row.brewConfigId,
      generatedAt: row.generatedAt.toISOString(),
      scrollPosition: Number(scroll ?? 0),
      ...payload,
    };
  }
  composition(id: number): Composition | null {
    const row = this.database.db.select().from(brewConfigs).where(eq(brewConfigs.id, id)).get();
    return row ? brewComposition(row) : null;
  }
  usesComposition(id: number): boolean {
    return (
      this.database.db
        .select({ version: brewConfigs.compositionVersion })
        .from(brewConfigs)
        .where(eq(brewConfigs.id, id))
        .get()?.version === 2
    );
  }
  createComposition(draft: CompositionDraft): number {
    return this.database.db
      .insert(brewConfigs)
      .values({
        name: draft.name.trim(),
        enabled: draft.enabled,
        sectionsJson: JSON.stringify(draft.sections),
        timezone: draft.timezone,
        scheduleJson: JSON.stringify(draft.schedule),
        deliveryJson: JSON.stringify(draft.delivery),
        scheduleCron: scheduleCron(draft.schedule),
        compositionVersion: 2,
      })
      .returning()
      .get().id;
  }
  updateComposition(id: number, draft: CompositionDraft): boolean {
    const previous = this.composition(id);
    const cron =
      previous && JSON.stringify(previous.schedule) === JSON.stringify(draft.schedule)
        ? previous.scheduleCron
        : scheduleCron(draft.schedule);
    return (
      this.database.db
        .update(brewConfigs)
        .set({
          name: draft.name.trim(),
          enabled: draft.enabled,
          sectionsJson: JSON.stringify(draft.sections),
          legacySectionsJson: null,
          timezone: draft.timezone,
          scheduleJson: JSON.stringify(draft.schedule),
          deliveryJson: JSON.stringify(draft.delivery),
          scheduleCron: cron,
          compositionVersion: 2,
        })
        .where(eq(brewConfigs.id, id))
        .run().changes > 0
    );
  }
  nextIssueNumber(id: number): number {
    const last = Number(this.setting(`brew_issue_number_${id}`) ?? 0);
    const retained = Number(
      (
        this.database.sqlite
          .prepare('SELECT coalesce(max(issue_number),0) AS last FROM brews WHERE brew_config_id=?')
          .get(id) as { last: number }
      ).last,
    );
    return Math.max(Number.isSafeInteger(last) && last >= 0 ? last : 0, retained) + 1;
  }
  savedSourceSearch(id: number): { query: string } | undefined {
    return this.database.sqlite
      .prepare('SELECT query FROM saved_source_searches WHERE id=?')
      .get(id) as { query: string } | undefined;
  }
  compositionItems(query: BrewItemQuery): BrewCandidate[] {
    const built = compositionItemsQuery(query);
    return built
      ? brewCandidates(
          this.database.sqlite.prepare(built.sql).all(...built.values) as BrewCandidateRow[],
        )
      : [];
  }
  setting(key: string): string | undefined {
    return (
      this.database.sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
        { value: string } | undefined
    )?.value;
  }
  articleStates(ids: number[]): BrewArticleState[] {
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.database.sqlite
      .prepare(
        `SELECT id, feed_id AS feedId, read_at AS readAt, starred_at AS starredAt, highlight_color AS highlightColor FROM articles WHERE id IN (${placeholders})`,
      )
      .all(...ids) as Array<{
      id: number;
      feedId: number;
      readAt: number | null;
      starredAt: number | null;
      highlightColor: string | null;
    }>;
    const logs = this.database.sqlite
      .prepare(
        `SELECT l.article_id AS articleId, r.id, r.name, l.actions_taken_json AS actions FROM rule_logs l JOIN rules r ON r.id = l.rule_id WHERE l.article_id IN (${placeholders}) ORDER BY l.executed_at DESC, l.id DESC`,
      )
      .all(...ids) as Array<{ articleId: number; id: number; name: string; actions: string }>;
    return brewArticleStates(ids, rows, logs);
  }
  setSetting(key: string, value: string): void {
    this.database.sqlite
      .prepare(
        'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, value);
  }
}
