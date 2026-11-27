import { eq } from 'drizzle-orm';
import {
  defaultNewsletterSettings,
  type NewsletterFeed,
  type NewsletterSettings,
} from '../../../../packages/core/src/types/newsletters.js';
import type {
  NewsletterArticle,
  NewsletterStoragePort,
  NewsletterInsertResult,
} from '../../../../packages/core/src/newsletter-pipeline.js';
import { feeds } from '../db/schema.js';
import { NodeIngestStorage } from './ingest-storage.js';
import { randomUUID } from 'node:crypto';

export class NodeNewsletterStorage extends NodeIngestStorage implements NewsletterStoragePort {
  retentionFeeds(): Array<{ id: number; retentionDays: number }> {
    return this.database.db
      .select({ id: feeds.id, retentionDays: feeds.retentionDays })
      .from(feeds)
      .where(eq(feeds.kind, 'newsletter'))
      .all();
  }

  ensureSender(sender: { address: string; name: string }): NewsletterFeed {
    return this.database.sqlite.transaction(() => {
      const url = `mailto:${sender.address}`;
      this.database.db
        .insert(feeds)
        .values({
          url,
          title: sender.name,
          kind: 'newsletter',
          settingsJson: JSON.stringify(defaultNewsletterSettings()),
        })
        .onConflictDoNothing({ target: feeds.url })
        .run();
      const feed = this.database.db.select().from(feeds).where(eq(feeds.url, url)).get()!;
      if (feed.kind !== 'newsletter')
        throw new Error('Sender address conflicts with an existing RSS subscription.');
      const settings = {
        ...defaultNewsletterSettings(),
        ...JSON.parse(feed.settingsJson),
        retentionDays: feed.retentionDays,
      } as NewsletterSettings;
      return { id: feed.id, retentionDays: feed.retentionDays, settings };
    })();
  }

  insertLetter(article: NewsletterArticle): NewsletterInsertResult {
    return this.database.sqlite.transaction(() => {
      const sender = this.database.sqlite
        .prepare(
          "SELECT coalesce(json_extract(settings_json,'$.blocked'),0) AS blocked FROM feeds WHERE id=?",
        )
        .get(article.feedId) as { blocked: number } | undefined;
      if (sender?.blocked) return { id: null, inserted: false as const, blocked: true as const };
      const duplicate = this.database.sqlite
        .prepare('SELECT id FROM articles WHERE feed_id = ? AND (guid = ? OR hash = ?)')
        .get(article.feedId, article.guid, article.hash) as { id: number } | undefined;
      if (duplicate) return { id: duplicate.id, inserted: false };
      const result = this.database.sqlite
        .prepare(
          `INSERT INTO articles
        (feed_id,guid,url,title,author,content_html,image_url,published_at,hash,raw_html,cleaning_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          article.feedId,
          article.guid,
          article.url,
          article.title,
          article.author,
          article.contentHtml,
          article.imageUrl,
          article.publishedAt.getTime(),
          article.hash,
          article.rawHtml,
          article.cleaningJson,
        );
      const id = Number(result.lastInsertRowid);
      if (!article.url)
        this.database.sqlite
          .prepare('UPDATE articles SET url = ? WHERE id = ?')
          .run(`/a/${id}`, id);
      if (this.queued) {
        const job = randomUUID();
        this.database.sqlite
          .prepare('INSERT INTO ingest_jobs(id,feed_id) VALUES(?,?)')
          .run(job, article.feedId);
        this.database.sqlite
          .prepare('INSERT INTO ingest_job_items(article_id,job_id) VALUES(?,?)')
          .run(id, job);
      }
      return { id, inserted: true };
    })();
  }
}
