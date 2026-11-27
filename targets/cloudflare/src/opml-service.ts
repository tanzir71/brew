import {
  readOpmlOutlines,
  previewOpml,
  exportOpml,
  type OpmlFeed,
  type OpmlFolder,
} from '../../../packages/core/src/opml.js';
import { CloudflareStorage } from './storage.js';

const incoming = `WITH input AS (SELECT json_extract(value,'$.title') AS title,json_extract(value,'$.url') AS url,json_extract(value,'$.siteUrl') AS siteUrl,json_extract(value,'$.folderTitle') AS folderTitle,CAST(key AS INTEGER) AS position FROM json_each(?)), unique_feeds AS (SELECT * FROM input GROUP BY url HAVING position=min(position)), additions AS (SELECT * FROM unique_feeds WHERE NOT EXISTS(SELECT 1 FROM feeds WHERE feeds.url=unique_feeds.url))`;
export class CloudflareOpml {
  constructor(private storage: CloudflareStorage) {}
  async preview(xml: string) {
    const outlines = readOpmlOutlines(xml);
    const result = await this.storage.batch([
      this.storage.statement('SELECT url FROM feeds'),
      this.storage.statement('SELECT title FROM folders'),
    ]);
    return previewOpml(
      outlines,
      new Set(result[0]!.results.map((row) => String(row.url))),
      new Set(result[1]!.results.map((row) => String(row.title))),
    );
  }
  importPlan(xml: string) {
    const outlines = readOpmlOutlines(xml),
      encoded = JSON.stringify(outlines);
    const statement = (sql: string, values: unknown[] = []) => ({ sql, values });
    const queries = [
      statement(
        `${incoming}, new_folders AS (SELECT folderTitle,min(position) AS firstPosition FROM additions WHERE folderTitle IS NOT NULL AND NOT EXISTS(SELECT 1 FROM folders WHERE title=folderTitle) GROUP BY folderTitle) INSERT INTO folders(title,position) SELECT folderTitle,(SELECT count(DISTINCT title) FROM folders)+row_number() OVER(ORDER BY firstPosition)-1 FROM new_folders ORDER BY firstPosition RETURNING id`,
        [encoded],
      ),
      statement(
        `${incoming} INSERT INTO feeds(folder_id,url,site_url,title) SELECT (SELECT max(id) FROM folders WHERE title=folderTitle),url,siteUrl,title FROM additions ORDER BY position RETURNING id`,
        [encoded],
      ),
      statement(
        "INSERT INTO settings(key,value) SELECT 'library_revision','1' WHERE changes()>0 ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1",
      ),
    ];
    return { queries, total: outlines.length };
  }
  async import(xml: string) {
    const plan = this.importPlan(xml);
    const result = await this.storage.batch(
      plan.queries.map((query) => this.storage.statement(query.sql, query.values)),
    );
    const imported = result[1]!.results.length;
    return { imported, skipped: plan.total - imported, foldersCreated: result[0]!.results.length };
  }
  async export() {
    const result = await this.storage.batch([
      this.storage.statement('SELECT id,title FROM folders ORDER BY position,title'),
      this.storage.statement(
        "SELECT title,url,site_url AS siteUrl,folder_id AS folderId FROM feeds WHERE kind='rss' ORDER BY title",
      ),
    ]);
    return exportOpml(
      result[0]!.results as unknown as OpmlFolder[],
      result[1]!.results as unknown as OpmlFeed[],
    );
  }
}
