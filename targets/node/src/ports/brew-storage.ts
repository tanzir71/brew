import { desc, eq } from 'drizzle-orm';
import type {
  BrewConfig,
  BrewConfigDraft,
  BrewSnapshot,
  BrewArticleState,
} from '../../../../packages/core/src/types/brew.js';
import type {
  BrewStoragePort,
  BrewItemQuery,
  BrewItemRow,
} from '../../../../packages/core/src/ports.js';
import type { BrewDatabase } from '../db/database.js';
import { brewConfigs, brews } from '../db/schema.js';
export class NodeBrewStorage implements BrewStoragePort {
  constructor(private readonly database: BrewDatabase) {}
  listConfigs(): BrewConfig[] {
    return this.database.db
      .select()
      .from(brewConfigs)
      .all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        scheduleCron: row.scheduleCron,
        enabled: row.enabled,
        sections: JSON.parse(row.sectionsJson),
        createdAt: row.createdAt.toISOString(),
      }));
  }
  create(draft: BrewConfigDraft): number {
    return this.database.db
      .insert(brewConfigs)
      .values({
        name: draft.name,
        scheduleCron: draft.scheduleCron,
        enabled: draft.enabled,
        sectionsJson: JSON.stringify(draft.sections),
      })
      .returning()
      .get().id;
  }
  update(id: number, draft: BrewConfigDraft): boolean {
    return Boolean(
      this.database.db
        .update(brewConfigs)
        .set({
          name: draft.name,
          scheduleCron: draft.scheduleCron,
          enabled: draft.enabled,
          sectionsJson: JSON.stringify(draft.sections),
        })
        .where(eq(brewConfigs.id, id))
        .returning()
        .get(),
    );
  }
  delete(id: number): boolean {
    return this.database.db.delete(brewConfigs).where(eq(brewConfigs.id, id)).run().changes > 0;
  }
  items(query: BrewItemQuery): BrewItemRow[] {
    const clauses = ['a.hidden = 0', 'a.excluded_from_brew = 0'];
    const params: Array<number | string> = [];
    if (query.onlyUnread) clauses.push('a.read_at IS NULL');
    if (query.folderId !== undefined) {
      clauses.push('f.folder_id = ?');
      params.push(query.folderId);
    }
    if (query.feedId !== undefined) {
      clauses.push('a.feed_id = ?');
      params.push(query.feedId);
    }
    if (query.tagId !== undefined) {
      clauses.push(
        'EXISTS (SELECT 1 FROM article_tags at JOIN tags t ON t.id=at.tag_id WHERE at.article_id=a.id AND t.id=?)',
      );
      params.push(query.tagId);
    }
    if (query.starred) clauses.push('a.starred_at IS NOT NULL');
    if (query.featured) clauses.push('a.featured_in_brew = 1');
    if (query.publishedSince !== undefined) {
      clauses.push('a.published_at >= ?');
      params.push(query.publishedSince);
    }
    const order =
      query.sort === 'longest'
        ? "length(coalesce(a.full_text_html,a.content_html,a.summary_html,'')) DESC"
        : 'a.published_at DESC';
    params.push(query.limit);
    return this.database.sqlite
      .prepare(
        `SELECT a.id,a.title,a.url,a.author,a.summary_html AS summaryHtml,a.image_url AS imageUrl,a.published_at AS publishedAt,a.read_at AS readAt,f.title AS feedTitle,coalesce(a.full_text_html,a.content_html,a.summary_html) AS body FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE ${clauses.join(' AND ')} ORDER BY ${order} LIMIT ?`,
      )
      .all(...params) as BrewItemRow[];
  }
  save(configId: number, payload: Pick<BrewSnapshot, 'configName' | 'sections'>): number {
    return this.database.db
      .insert(brews)
      .values({ brewConfigId: configId, payloadJson: JSON.stringify(payload) })
      .returning()
      .get().id;
  }
  prune(configId: number, keep: number): void {
    for (const id of this.historyIds(configId).slice(keep))
      this.database.db.delete(brews).where(eq(brews.id, id)).run();
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
  snapshot(id: number): BrewSnapshot | null {
    const row = this.database.db.select().from(brews).where(eq(brews.id, id)).get();
    if (!row) return null;
    const payload = JSON.parse(row.payloadJson) as Pick<BrewSnapshot, 'configName' | 'sections'>;
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
    return ids.map((id) => {
      const row = rows.find((item) => item.id === id);
      const applied = new Map<number, { id: number; name: string }>();
      for (const log of logs.filter((entry) => entry.articleId === id)) {
        const actions = JSON.parse(log.actions) as Array<{ ok: boolean }>;
        if (actions.some((action) => action.ok))
          applied.set(log.id, { id: log.id, name: log.name });
      }
      return {
        id,
        feedId: row?.feedId ?? null,
        available: !!row,
        readAt: row?.readAt == null ? null : new Date(row.readAt).toISOString(),
        starredAt: row?.starredAt == null ? null : new Date(row.starredAt).toISOString(),
        highlightColor: row?.highlightColor ?? null,
        rules: [...applied.values()],
      };
    });
  }
  setSetting(key: string, value: string): void {
    this.database.sqlite
      .prepare(
        'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, value);
  }
}
