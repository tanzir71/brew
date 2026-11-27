import { compileFtsQuery } from '../../core/src/search-service.js';
import { articleText } from '../../core/src/article-reading.js';
import { legacySections, upgradeLegacyDraft } from '../../core/src/composition-model.js';
import type { BrewCandidate, BrewItemQuery } from '../../core/src/ports.js';
import type { BrewConfig as Composition } from '../../core/src/types/brew.js';
import type { BrewConfig, BrewArticleState } from '../../core/src/types/legacy-brew.js';
import type { brewConfigs } from './schema.js';
import type { SqlQuery } from './reader-queries.js';

export type BrewConfigRow = Omit<typeof brewConfigs.$inferSelect, 'createdAt'> & {
  createdAt: number | Date;
};
export function brewConfigFromRaw(row: Record<string, unknown>): BrewConfigRow {
  return {
    id: Number(row.id),
    name: String(row.name),
    enabled: !!row.enabled,
    scheduleCron: String(row.schedule_cron),
    sectionsJson: String(row.sections_json),
    timezone: String(row.timezone),
    scheduleJson: String(row.schedule_json),
    deliveryJson: String(row.delivery_json),
    legacySectionsJson: row.legacy_sections_json === null ? null : String(row.legacy_sections_json),
    compositionVersion: Number(row.composition_version),
    createdAt: Number(row.created_at),
  };
}
export function legacyBrewConfig(row: BrewConfigRow): BrewConfig {
  return {
    id: row.id,
    name: row.name,
    scheduleCron: row.scheduleCron,
    enabled: !!row.enabled,
    sections: row.legacySectionsJson
      ? JSON.parse(row.legacySectionsJson)
      : JSON.parse(row.sectionsJson)[0]?.kind
        ? legacySections(JSON.parse(row.sectionsJson))
        : JSON.parse(row.sectionsJson),
    createdAt: new Date(row.createdAt).toISOString(),
  };
}
export function brewComposition(row: BrewConfigRow): Composition {
  const sections = JSON.parse(row.sectionsJson);
  const value =
    sections[0] && !sections[0].kind
      ? upgradeLegacyDraft(
          { name: row.name, scheduleCron: row.scheduleCron, enabled: !!row.enabled, sections },
          row.timezone,
        )
      : {
          sections,
          timezone: row.timezone,
          schedule: JSON.parse(row.scheduleJson),
          delivery: JSON.parse(row.deliveryJson),
        };
  return {
    id: row.id,
    name: row.name,
    enabled: !!row.enabled,
    createdAt: new Date(row.createdAt).toISOString(),
    scheduleCron: row.scheduleCron,
    ...value,
  };
}
export type BrewCandidateRow = Omit<BrewCandidate, 'content'> & {
  feedKind: string;
  cleaningJson: string | null;
};
export function compositionItemsQuery(query: BrewItemQuery): SqlQuery | null {
  const clauses = ['a.hidden=0', 'a.excluded_from_brew=0'];
  if (query.searchQuery !== undefined && !compileFtsQuery(query.searchQuery)) return null;
  const params: Array<number | string> = [];
  if (query.newsletters) {
    clauses.push("f.kind='newsletter'");
    const selectors: string[] = [];
    if (query.newsletters.senderIds !== undefined) {
      selectors.push(
        query.newsletters.senderIds.length ? 'f.id IN (SELECT value FROM json_each(?))' : '0=1',
      );
      if (query.newsletters.senderIds.length)
        params.push(JSON.stringify(query.newsletters.senderIds));
    }
    if (query.newsletters.tagIds !== undefined) {
      selectors.push(
        query.newsletters.tagIds.length
          ? 'EXISTS(SELECT 1 FROM article_tags at WHERE at.article_id=a.id AND at.tag_id IN (SELECT value FROM json_each(?)))'
          : '0=1',
      );
      if (query.newsletters.tagIds.length) params.push(JSON.stringify(query.newsletters.tagIds));
    }
    if (selectors.length) clauses.push(`(${selectors.join(' OR ')})`);
  }
  if (query.onlyUnread) clauses.push('a.read_at IS NULL');
  if (query.folderId !== undefined) {
    clauses.push('f.folder_id=?');
    params.push(query.folderId);
  }
  if (query.feedId !== undefined) {
    clauses.push('a.feed_id=?');
    params.push(query.feedId);
  }
  if (query.tagId !== undefined) {
    clauses.push('EXISTS(SELECT 1 FROM article_tags at WHERE at.article_id=a.id AND at.tag_id=?)');
    params.push(query.tagId);
  }
  if (query.starred) clauses.push('a.starred_at IS NOT NULL');
  if (query.featured) clauses.push('a.featured_in_brew=1');
  if (query.publishedSince !== undefined) {
    clauses.push('a.published_at>=?');
    params.push(query.publishedSince);
  }
  if (query.searchQuery !== undefined) {
    clauses.push(
      'f.muted=0',
      'a.id IN (SELECT rowid FROM articles_fts WHERE articles_fts MATCH ?)',
    );
    params.push(compileFtsQuery(query.searchQuery)!);
  }
  return {
    sql: `SELECT f.kind AS feedKind,a.cleaning_json AS cleaningJson,a.id,a.title,a.url,coalesce(a.author,'') AS author,a.feed_id AS feedId,f.title AS feed,f.folder_id AS folderId,coalesce(fo.title,'') AS folder,a.summary_html AS summaryHtml,a.image_url AS imageUrl,a.published_at AS publishedAt,a.read_at AS readAt,coalesce(a.full_text_html,a.content_html,a.summary_html,'') AS body FROM articles a JOIN feeds f ON f.id=a.feed_id LEFT JOIN folders fo ON fo.id=f.folder_id WHERE ${clauses.join(' AND ')}`,
    values: params,
  };
}

export function brewCandidates(rows: BrewCandidateRow[]): BrewCandidate[] {
  return rows.map(({ feedKind, cleaningJson, ...row }) => ({
    ...row,
    content: articleText(row.body),
    ...(feedKind === 'newsletter'
      ? {
          newsletter: {
            cleaning: cleaningJson
              ? (JSON.parse(
                  cleaningJson,
                ) as import('../../core/src/types/newsletters.js').NewsletterCleaning)
              : null,
          },
        }
      : {}),
  }));
}

export function legacyBrewItemsQuery(query: BrewItemQuery): SqlQuery {
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
  params.push(query.limit ?? 20);
  return {
    sql: `SELECT a.id,a.title,a.url,a.author,a.summary_html AS summaryHtml,a.image_url AS imageUrl,a.published_at AS publishedAt,a.read_at AS readAt,f.title AS feedTitle,coalesce(a.full_text_html,a.content_html,a.summary_html) AS body FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE ${clauses.join(' AND ')} ORDER BY ${order} LIMIT ?`,
    values: params,
  };
}

export interface BrewArticleStateRow {
  id: number;
  feedId: number;
  readAt: number | null;
  starredAt: number | null;
  highlightColor: string | null;
}
export interface BrewRuleLogRow {
  articleId: number;
  id: number;
  name: string;
  actions: string;
}
export function brewArticleStates(
  ids: number[],
  rows: BrewArticleStateRow[],
  logs: BrewRuleLogRow[],
): BrewArticleState[] {
  return ids.map((id) => {
    const row = rows.find((item) => item.id === id);
    const applied = new Map<number, { id: number; name: string }>();
    for (const log of logs.filter((entry) => entry.articleId === id)) {
      const actions = JSON.parse(log.actions) as Array<{ ok: boolean }>;
      if (actions.some((action) => action.ok)) applied.set(log.id, { id: log.id, name: log.name });
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
