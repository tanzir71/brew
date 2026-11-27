import {
  newsletterSendersQuery,
  newsletterSender,
  newsletterOverview,
  newsletterLettersQuery,
  newsletterBrewsQuery,
  letterMetadataQuery,
  letterOriginalQuery,
  senderAffectedQuery,
  type SenderRow,
  type SenderAffectedRow,
  type NewsletterLetterRow,
} from '../../../../packages/db/src/newsletter-queries.js';
import {
  senderPreviewPlan,
  senderPreviewReview,
  newsletterLetters,
} from '../../../../packages/core/src/newsletter-library.js';
import { createHash } from 'node:crypto';
import type { BrewDatabase } from '../db/database.js';
import type { ClockPort } from '../../../../packages/core/src/ports.js';
import {
  type NewsletterSender,
  type NewsletterOverview,
  type NewsletterLetterQuery,
  type NewsletterLetterPage,
  type NewsletterLetter,
  type NewsletterCleaning,
  type SenderSettingsPreview,
} from '../../../../packages/core/src/types/newsletters.js';
import {
  updateNewsletterSettings,
  newsletterRoutingChanges,
  newsletterSettingsPatch,
} from '../../../../packages/core/src/newsletter-settings.js';
import { ArticleService } from './article-service.js';
import { NodeIngestStorage } from '../ports/ingest-storage.js';
import { NodeBrewStorage } from '../ports/brew-storage.js';
import { nodeClock } from '../ports/runtime.js';
import { sanitizeArticleHtml } from '../../../../packages/core/src/html-sanitizer.js';

export class NewsletterLibrary {
  constructor(
    private readonly database: BrewDatabase,
    private readonly clock: ClockPort = nodeClock,
  ) {}
  previewSenderSettings(id: number, input: unknown): SenderSettingsPreview | null {
    return this.database.sqlite.transaction(() => {
      const current = this.senders(id)[0];
      if (!current) return null;
      const patch = newsletterSettingsPatch(input);
      if (!Object.keys(patch).length) throw new Error('Choose at least one sender setting.');
      const updated = updateNewsletterSettings(current.settings, patch);
      const configs = this.database.sqlite
        .prepare('SELECT * FROM brew_configs WHERE id=? OR id=? ORDER BY id')
        .all(current.settings.brewId ?? 0, updated.brewId ?? 0) as Array<
        Record<string, unknown> & { id: number; name: string }
      >;
      const affected =
        updated.retentionDays === current.settings.retentionDays
          ? []
          : (this.database.sqlite
              .prepare(senderAffectedQuery)
              .all(
                id,
                this.clock.now().getTime() - updated.retentionDays * 86_400_000,
              ) as SenderAffectedRow[]);
      const identity = this.database.sqlite
        .prepare('SELECT title,url,settings_json,retention_days FROM feeds WHERE id=?')
        .get(id);
      const plan = senderPreviewPlan(current, patch, configs, affected, identity);
      return senderPreviewReview(
        plan,
        createHash('sha256').update(plan.revisionInput).digest('hex'),
      );
    })();
  }
  private senders(id?: number): NewsletterSender[] {
    const built = newsletterSendersQuery(id);
    return (this.database.sqlite.prepare(built.sql).all(...built.values) as SenderRow[]).map(
      newsletterSender,
    );
  }
  overview(): NewsletterOverview {
    return newsletterOverview(
      this.senders(),
      this.database.sqlite.prepare(newsletterBrewsQuery).all() as Array<{
        id: number;
        name: string;
      }>,
    );
  }
  letters(query: NewsletterLetterQuery): NewsletterLetterPage {
    const built = newsletterLettersQuery(query);
    const total = (
      this.database.sqlite.prepare(built.count.sql).get(...built.count.values) as { n: number }
    ).n;
    const rows = this.database.sqlite
      .prepare(built.rows.sql)
      .all(...built.rows.values) as NewsletterLetterRow[];
    return { page: query.page, pageSize: 50, total, items: newsletterLetters(rows) };
  }
  letter(id: number): NewsletterLetter | null {
    const row = this.database.sqlite.prepare(letterMetadataQuery).get(id) as
      { feed_id: number; cleaning_json: string | null; original: number } | undefined;
    if (!row) return null;
    const article = new ArticleService(this.database).get(id);
    if (!article) return null;
    article.contentHtml = sanitizeArticleHtml(article.contentHtml);
    article.fullTextHtml = sanitizeArticleHtml(article.fullTextHtml);
    article.summaryHtml = sanitizeArticleHtml(article.summaryHtml);
    return {
      ...article,
      sender: this.senders(row.feed_id)[0]!,
      cleaning: row.cleaning_json ? (JSON.parse(row.cleaning_json) as NewsletterCleaning) : null,
      originalAvailable: !!row.original,
    };
  }
  original(id: number): string | null {
    return (
      (
        this.database.sqlite.prepare(letterOriginalQuery).get(id) as
          { html: string | null } | undefined
      )?.html ?? null
    );
  }
  updateSender(id: number, input: unknown): NewsletterSender | null {
    return this.database.sqlite.transaction(() => {
      const current = this.senders(id)[0];
      if (!current) return null;
      const updated = updateNewsletterSettings(current.settings, input);
      if (updated.brewId !== current.settings.brewId)
        this.routeSender(id, current.settings.brewId, updated.brewId);
      this.database.sqlite
        .prepare(
          "UPDATE feeds SET settings_json=?,retention_days=? WHERE id=? AND kind='newsletter'",
        )
        .run(JSON.stringify(updated), updated.retentionDays, id);
      if (updated.retentionDays !== current.settings.retentionDays)
        new NodeIngestStorage(this.database).prune(
          id,
          this.clock.now().getTime() - updated.retentionDays * 86_400_000,
        );
      return this.senders(id)[0]!;
    })();
  }
  private routeSender(id: number, previousId?: number, nextId?: number): void {
    const storage = new NodeBrewStorage(this.database);
    const target = nextId ? storage.composition(nextId) : null;
    const previous = previousId ? storage.composition(previousId) : null;
    for (const changed of newsletterRoutingChanges(id, previous, target, nextId))
      storage.updateComposition(changed.id, changed);
  }
}
