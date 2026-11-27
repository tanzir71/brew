import type {
  NewsletterLetterQuery,
  NewsletterSettingsPatch,
} from '../../../packages/core/src/types/newsletters.js';
import {
  newsletterSettingsPatch,
  updateNewsletterSettings,
  newsletterRoutingChanges,
} from '../../../packages/core/src/newsletter-settings.js';
import {
  senderPreviewPlan,
  senderPreviewReview,
  newsletterLetters,
} from '../../../packages/core/src/newsletter-library.js';
import { sanitizeArticleHtml } from '../../../packages/core/src/html-sanitizer.js';
import { brewComposition, brewConfigFromRaw } from '../../../packages/db/src/brew-queries.js';
import {
  newsletterSendersQuery,
  newsletterSender,
  newsletterOverview,
  newsletterBrewsQuery,
  newsletterLettersQuery,
  letterMetadataQuery,
  letterOriginalQuery,
  senderAffectedQuery,
  senderAffectedSnapshotQuery,
  type SenderRow,
  type SenderAffectedRow,
  type NewsletterLetterRow,
} from '../../../packages/db/src/newsletter-queries.js';
import { CloudflareStorage } from './storage.js';
import { CloudflareArticles } from './article-service.js';

type RawConfig = Record<string, unknown> & { id: number; name: string };
export class CloudflareNewsletterLibrary {
  constructor(
    private storage: CloudflareStorage,
    private articles: CloudflareArticles,
    private now: () => Date = () => new Date(),
  ) {}
  private async senders(id?: number) {
    const built = newsletterSendersQuery(id);
    return (await this.storage.all<SenderRow>(built.sql, built.values)).map(newsletterSender);
  }
  async overview() {
    const built = newsletterSendersQuery();
    const result = await this.storage.batch([
      this.storage.statement(built.sql, built.values),
      this.storage.statement(newsletterBrewsQuery),
    ]);
    return newsletterOverview(
      (result[0]!.results as unknown as SenderRow[]).map(newsletterSender),
      result[1]!.results as unknown as Array<{ id: number; name: string }>,
    );
  }
  async letters(query: NewsletterLetterQuery) {
    const built = newsletterLettersQuery(query);
    const result = await this.storage.batch([
      this.storage.statement(built.count.sql, built.count.values),
      this.storage.statement(built.rows.sql, built.rows.values),
    ]);
    return {
      page: query.page,
      pageSize: 50,
      total: Number(result[0]!.results[0]!.n),
      items: newsletterLetters(result[1]!.results as unknown as NewsletterLetterRow[]),
    };
  }
  async letter(id: number) {
    if (!Number.isSafeInteger(id) || id < 1) return null;
    const row = await this.storage.first<{
      feed_id: number;
      cleaning_json: string | null;
      original: number;
    }>(letterMetadataQuery, [id]);
    if (!row) return null;
    const article = await this.articles.get(id);
    if (!article) return null;
    const sender = (await this.senders(row.feed_id))[0];
    if (!sender) return null;
    return {
      ...article,
      contentHtml: sanitizeArticleHtml(article.contentHtml),
      fullTextHtml: sanitizeArticleHtml(article.fullTextHtml),
      summaryHtml: sanitizeArticleHtml(article.summaryHtml),
      sender,
      cleaning: row.cleaning_json
        ? (JSON.parse(
            row.cleaning_json,
          ) as import('../../../packages/core/src/types/newsletters.js').NewsletterCleaning)
        : null,
      originalAvailable: !!row.original,
    };
  }
  async original(id: number) {
    if (!Number.isSafeInteger(id) || id < 1) return null;
    return (
      (await this.storage.first<{ html: string | null }>(letterOriginalQuery, [id]))?.html ?? null
    );
  }
  private async snapshot(id: number, patch: NewsletterSettingsPatch) {
    const sender = newsletterSendersQuery(id),
      at = this.now().getTime();
    const affectedQuery = senderAffectedSnapshotQuery(id, at, patch.retentionDays);
    const result = await this.storage.batch([
      this.storage.statement(sender.sql, sender.values),
      this.storage.statement(
        "SELECT * FROM brew_configs WHERE id=coalesce((SELECT json_extract(settings_json,'$.brewId') FROM feeds WHERE id=?),0) OR id=? ORDER BY id",
        [id, patch.brewId ?? 0],
      ),
      this.storage.statement(affectedQuery.sql, affectedQuery.values),
    ]);
    const raw = result[0]!.results[0] as unknown as SenderRow | undefined;
    if (!raw) return null;
    const current = newsletterSender(raw),
      updated = updateNewsletterSettings(current.settings, patch);
    const cutoff = at - updated.retentionDays * 86_400_000;
    const affected = result[2]!.results as unknown as SenderAffectedRow[];
    return {
      raw,
      current,
      updated,
      configs: result[1]!.results as unknown as RawConfig[],
      affected,
      cutoff,
    };
  }
  async previewSenderSettings(id: number, input: unknown) {
    if (!Number.isSafeInteger(id) || id < 1) return null;
    if (!(await this.senders(id))[0]) return null;
    const patch = newsletterSettingsPatch(input);
    if (!Object.keys(patch).length) throw new Error('Choose at least one sender setting.');
    const snapshot = await this.snapshot(id, patch);
    if (!snapshot) return null;
    return this.review(snapshot, patch);
  }
  private async review(
    state: NonNullable<Awaited<ReturnType<CloudflareNewsletterLibrary['snapshot']>>>,
    patch: NewsletterSettingsPatch,
  ) {
    const { current, configs, affected, raw } = state;
    const plan = senderPreviewPlan(current, patch, configs, affected, {
      title: raw.title,
      url: raw.url,
      settings_json: raw.settings,
      retention_days: raw.retention,
    });
    const hash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plan.revisionInput)),
    );
    return senderPreviewReview(
      plan,
      Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join(''),
    );
  }
  async prepareUpdate(id: number, input: unknown) {
    if (!Number.isSafeInteger(id) || id < 1) return null;
    if (!(await this.senders(id))[0]) return null;
    const patch = newsletterSettingsPatch(input);
    const state = await this.snapshot(id, patch);
    if (!state) return null;
    const { raw, current, updated, configs, affected, cutoff } = state;
    const composition = (configId?: number) => {
      const row = configs.find((row) => row.id === configId);
      return row ? brewComposition(brewConfigFromRaw(row)) : null;
    };
    const changes =
      updated.brewId === current.settings.brewId
        ? []
        : newsletterRoutingChanges(
            id,
            composition(current.settings.brewId),
            composition(updated.brewId),
            updated.brewId,
          );
    const token = `newsletter_update:${crypto.randomUUID()}`,
      marker = 'EXISTS(SELECT 1 FROM settings WHERE key=?)';
    const guards = [
      "EXISTS(SELECT 1 FROM feeds WHERE id=? AND kind='newsletter' AND title IS ? AND url IS ? AND settings_json IS ? AND retention_days IS ?)",
    ];
    const values: unknown[] = [token, id, raw.title, raw.url, raw.settings, raw.retention];
    for (const row of configs) {
      const entries = Object.entries(row);
      guards.push(
        `EXISTS(SELECT 1 FROM brew_configs WHERE ${entries.map(([key]) => `"${key.replaceAll('"', '""')}" IS ?`).join(' AND ')})`,
      );
      values.push(...entries.map(([, value]) => value));
    }
    const retentionChanged = updated.retentionDays !== current.settings.retentionDays;
    if (retentionChanged) {
      guards.push(
        `(SELECT json_group_array(json_array(id,original,discard)) FROM (${senderAffectedQuery}))=?`,
      );
      values.push(
        id,
        cutoff,
        JSON.stringify(affected.map((row) => [row.id, row.original, row.discard])),
      );
    }
    const statement = (sql: string, values: unknown[] = []) => ({ sql, values });
    const statements = [
      statement(
        `INSERT INTO settings(key,value) SELECT ?,'1' WHERE ${guards.join(' AND ')} RETURNING key`,
        values,
      ),
    ];
    for (const config of changes)
      statements.push(
        statement(
          `UPDATE brew_configs SET name=?,enabled=?,sections_json=?,legacy_sections_json=NULL,timezone=?,schedule_json=?,delivery_json=?,schedule_cron=?,composition_version=2 WHERE id=? AND ${marker}`,
          [
            config.name.trim(),
            Number(config.enabled),
            JSON.stringify(config.sections),
            config.timezone,
            JSON.stringify(config.schedule),
            JSON.stringify(config.delivery),
            config.scheduleCron,
            config.id,
            token,
          ],
        ),
      );
    statements.push(
      statement(`UPDATE feeds SET settings_json=?,retention_days=? WHERE id=? AND ${marker}`, [
        JSON.stringify(updated),
        updated.retentionDays,
        id,
        token,
      ]),
    );
    if (retentionChanged) {
      statements.push(
        statement(
          `UPDATE articles SET raw_html=NULL WHERE feed_id=? AND published_at<? AND raw_html IS NOT NULL AND ${marker}`,
          [id, cutoff, token],
        ),
      );
      statements.push(
        statement(
          `DELETE FROM articles WHERE feed_id=? AND published_at<? AND starred_at IS NULL AND NOT EXISTS(SELECT 1 FROM article_tags WHERE article_id=articles.id) AND NOT EXISTS(SELECT 1 FROM ingest_job_items p WHERE p.article_id=articles.id) AND ${marker}`,
          [id, cutoff, token],
        ),
      );
    }
    statements.push(
      statement(
        `INSERT INTO settings(key,value) SELECT 'library_revision','1' WHERE ${marker} ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1`,
        [token],
      ),
    );
    statements.push(statement('DELETE FROM settings WHERE key=?', [token]));
    return {
      queries: statements,
      valid: { sql: guards.join(' AND '), values: values.slice(1) },
      review: await this.review(state, patch),
    };
  }
  async updateSender(id: number, input: unknown) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const plan = await this.prepareUpdate(id, input);
      if (!plan) return null;
      if (
        (
          await this.storage.batch(
            plan.queries.map((query) => this.storage.statement(query.sql, query.values)),
          )
        )[0]!.results.length
      )
        return (await this.senders(id))[0] ?? null;
    }
    throw new Error('Sender settings changed. Please retry your update.');
  }
}
