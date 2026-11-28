import type { ArticleApiPort, MarkAllScope } from '../../api/src/ports.js';
import type {
  ArticleDetail,
  TagSummary,
  TagChanges,
} from '../../core/src/types/api.js';
import {
  articleReadTime,
  extractReadableHtml,
} from '../../core/src/article-reading.js';
import { parseTagChanges } from '../../core/src/tag-changes.js';
import {
  articleSummary,
  articleSummaryColumns,
  articleJoins,
  readerScope,
  type ArticleSummaryRow,
} from './reader-queries.js';
import type { AsyncSqlStorage } from './async-storage.js';
import { libraryRevision } from './async-storage.js';

type DetailRow = ArticleSummaryRow & { contentHtml: string | null; fullTextHtml: string | null };
const validId = (id: number) => Number.isSafeInteger(id) && id > 0;
const receiptPrefix = 'legacy-read:';
export class SqlArticles<Statement> implements ArticleApiPort {
  constructor(
    private storage: AsyncSqlStorage<Statement>,
    private fetcher: typeof fetch = globalThis.fetch,
    private now: () => Date = () => new Date(),
  ) {}
  async get(id: number): Promise<ArticleDetail | null> {
    if (!validId(id)) return null;
    const results = await this.storage.batch<DetailRow | TagSummary>([
      this.storage.statement(
        `SELECT ${articleSummaryColumns},a.content_html AS contentHtml,a.full_text_html AS fullTextHtml ${articleJoins} WHERE a.id=?`,
        [id],
      ),
      this.storage.statement(
        'SELECT t.id,t.name,t.color FROM tags t JOIN article_tags at ON at.tag_id=t.id WHERE at.article_id=? ORDER BY t.name',
        [id],
      ),
    ]);
    const row = results[0]!.results[0] as DetailRow | undefined;
    return row
      ? {
          ...articleSummary(row),
          contentHtml: row.contentHtml,
          fullTextHtml: row.fullTextHtml,
          readTimeMinutes: articleReadTime(row.fullTextHtml ?? row.contentHtml ?? row.summaryHtml),
          tags: results[1]!.results as TagSummary[],
        }
      : null;
  }
  async extractFullText(id: number) {
    const current = await this.get(id);
    if (!current || current.fullTextHtml) return current;
    const html = await extractReadableHtml(current.url, this.fetcher);
    await this.storage.batch([
      this.storage.statement(
        'UPDATE articles SET full_text_html=? WHERE id=? AND full_text_html IS NULL',
        [html, id],
      ),
      libraryRevision(this.storage),
    ]);
    return this.get(id);
  }
  async updateState(id: number, values: { read?: boolean; starred?: boolean }) {
    if (!validId(id)) return null;
    const columns: string[] = [],
      parameters: unknown[] = [];
    for (const [field, column] of [
      ['read', 'read_at'],
      ['starred', 'starred_at'],
    ] as const)
      if (values[field] !== undefined) {
        columns.push(`${column}=?`);
        parameters.push(values[field] ? this.now().getTime() : null);
      }
    if (columns.length)
      await this.storage.batch([
        this.storage.statement(`UPDATE articles SET ${columns.join(',')} WHERE id=?`, [
          ...parameters,
          id,
        ]),
        libraryRevision(this.storage),
      ]);
    return this.get(id);
  }
  async listTags() {
    return this.storage.all<TagSummary>('SELECT id,name,color FROM tags ORDER BY name');
  }
  async createTag(name: string, color = '#b45309') {
    name = name.trim();
    if (!name) throw new Error('Tag name is required');
    const result = await this.storage.batch<TagSummary>([
      this.storage.statement(
        'INSERT INTO tags(name,color) VALUES(?,?) ON CONFLICT(name) DO NOTHING',
        [name, color],
      ),
      this.storage.statement('SELECT id,name,color FROM tags WHERE name=?', [name]),
      libraryRevision(this.storage),
    ]);
    return result[1]!.results[0] as TagSummary;
  }
  private async exists(id: number) {
    return (
      validId(id) && Boolean(await this.storage.first('SELECT id FROM articles WHERE id=?', [id]))
    );
  }
  private async validateTags(ids: number[]) {
    if (!ids.length) return;
    const found = await this.storage.first<{ n: number }>(
      'SELECT count(*) AS n FROM tags WHERE id IN(SELECT value FROM json_each(?))',
      [JSON.stringify(ids)],
    );
    if (found?.n !== ids.length) throw new Error('One or more tags do not exist');
  }
  async setTags(id: number, tagIds: number[]) {
    if (!(await this.exists(id))) return null;
    const ids = [...new Set(tagIds)];
    await this.validateTags(ids);
    await this.storage.batch([
      this.storage.statement('DELETE FROM article_tags WHERE article_id=?', [id]),
      this.storage.statement(
        'INSERT INTO article_tags(article_id,tag_id) SELECT ?,value FROM json_each(?)',
        [id, JSON.stringify(ids)],
      ),
      libraryRevision(this.storage),
    ]);
    return this.get(id);
  }
  async changeTags(id: number, input: TagChanges) {
    const { add, remove } = parseTagChanges(input);
    if (!(await this.exists(id))) return null;
    await this.validateTags(add);
    await this.storage.batch([
      this.storage.statement(
        'DELETE FROM article_tags WHERE article_id=? AND tag_id IN(SELECT value FROM json_each(?))',
        [id, JSON.stringify(remove)],
      ),
      this.storage.statement(
        'INSERT INTO article_tags(article_id,tag_id) SELECT ?,value FROM json_each(?) WHERE 1 ON CONFLICT DO NOTHING',
        [id, JSON.stringify(add)],
      ),
      libraryRevision(this.storage),
    ]);
    return this.get(id);
  }
  async markAllRead(scope: MarkAllScope) {
    const stamp = this.now().getTime(),
      expiresAt = stamp + 5_000,
      token = crypto.randomUUID(),
      key = receiptPrefix + token;
    const { clauses, values } = readerScope({ ...scope, unread: true }, stamp);
    const result = await this.storage.batch([
      this.storage.statement(
        `INSERT INTO settings(key,value) SELECT ?,json_object('ids',json_group_array(a.id),'stamp',?,'expiresAt',?) ${articleJoins} WHERE ${clauses.join(' AND ')}`,
        [key, stamp, expiresAt, ...values],
      ),
      this.storage.statement(
        "UPDATE articles SET read_at=? WHERE read_at IS NULL AND id IN(SELECT value FROM json_each((SELECT json_extract(value,'$.ids') FROM settings WHERE key=?)))",
        [stamp, key],
      ),
      this.storage.statement(
        "DELETE FROM settings WHERE key LIKE 'legacy-read:%' AND json_extract(value,'$.expiresAt')<=?",
        [stamp],
      ),
      libraryRevision(this.storage),
    ]);
    return {
      updated: result[1]!.meta.changes,
      undoToken: token,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }
  async undoMarkAll(token: string) {
    if (!/^[a-f\d-]{36}$/i.test(token)) return null;
    const key = receiptPrefix + token,
      now = this.now().getTime();
    const result = await this.storage.batch([
      this.storage.statement(
        `UPDATE articles SET read_at=NULL WHERE read_at=(SELECT json_extract(value,'$.stamp') FROM settings WHERE key=?)
        AND id IN(SELECT value FROM json_each((SELECT json_extract(value,'$.ids') FROM settings WHERE key=?)))
        AND EXISTS(SELECT 1 FROM settings WHERE key=? AND json_extract(value,'$.expiresAt')>?)`,
        [key, key, key, now],
      ),
      this.storage.statement('DELETE FROM settings WHERE key=? RETURNING value', [key]),
      libraryRevision(this.storage),
    ]);
    const receipt = result[1]!.results[0] as { value: string } | undefined;
    return receipt && JSON.parse(receipt.value).expiresAt > now ? result[0]!.meta.changes : null;
  }
}
