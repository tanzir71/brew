import {
  defaultNewsletterSettings,
  type NewsletterSettings,
} from '../../../packages/core/src/types/newsletters.js';
import type {
  NewsletterArticle,
  NewsletterStoragePort,
} from '../../../packages/core/src/newsletter-pipeline.js';
import { CloudflareIngestStorage } from './ingest-storage.js';

export class CloudflareNewsletterStorage
  extends CloudflareIngestStorage
  implements NewsletterStoragePort
{
  async retentionFeeds() {
    return this.storage.all<{ id: number; retentionDays: number }>(
      "SELECT id,retention_days AS retentionDays FROM feeds WHERE kind='newsletter'",
    );
  }
  async ensureSender(sender: { address: string; name: string }) {
    const url = `mailto:${sender.address}`;
    const results = await this.storage.batch([
      this.storage.statement(
        "INSERT INTO feeds(url,title,kind,settings_json) VALUES(?,?,'newsletter',?) ON CONFLICT(url) DO NOTHING",
        [url, sender.name, JSON.stringify(defaultNewsletterSettings())],
      ),
      this.storage.statement('SELECT id,kind,settings_json,retention_days FROM feeds WHERE url=?', [
        url,
      ]),
    ]);
    const row = results[1]!.results[0] as {
      id: number;
      kind: string;
      settings_json: string;
      retention_days: number;
    };
    if (row.kind !== 'newsletter')
      throw new Error('Sender address conflicts with an existing RSS subscription.');
    return {
      id: row.id,
      retentionDays: row.retention_days,
      settings: {
        ...defaultNewsletterSettings(),
        ...JSON.parse(row.settings_json),
        retentionDays: row.retention_days,
      } as NewsletterSettings,
    };
  }
  async insertLetter(item: NewsletterArticle) {
    const results = await this.storage.batch([
      this.storage.statement(
        `INSERT INTO articles(feed_id,guid,url,title,author,content_html,image_url,published_at,hash,raw_html,cleaning_json)
         SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS
         (SELECT 1 FROM articles WHERE feed_id=? AND (guid=? OR hash=?)) RETURNING id`,
        [
          item.feedId,
          item.guid,
          item.url,
          item.title,
          item.author,
          item.contentHtml,
          item.imageUrl,
          item.publishedAt.getTime(),
          item.hash,
          item.rawHtml,
          item.cleaningJson,
          item.feedId,
          item.guid,
          item.hash,
        ],
      ),
      this.storage.statement(
        "UPDATE articles SET url='/a/'||id WHERE feed_id=? AND (guid=? OR hash=?) AND url=''",
        [item.feedId, item.guid, item.hash],
      ),
      this.storage.statement(
        'SELECT id FROM articles WHERE feed_id=? AND (guid=? OR hash=?) ORDER BY id LIMIT 1',
        [item.feedId, item.guid, item.hash],
      ),
    ]);
    const row = results[2]!.results[0] as { id: number } | undefined;
    if (!row) throw new Error('Could not store newsletter');
    return { id: row.id, inserted: results[0]!.results.length === 1 };
  }
}
