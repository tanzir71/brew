import { senderInNewsletterView } from '../../../../packages/core/src/types/newsletters.js';
import { createHash } from 'node:crypto';
import { parseHTML } from 'linkedom';
import type { BrewDatabase } from '../db/database.js';
import type { ClockPort } from '../../../../packages/core/src/ports.js';
import {
  defaultNewsletterSettings,
  type NewsletterSettings,
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
  newsletterBrewSections,
  newsletterSettingsPatch,
} from '../../../../packages/core/src/newsletter-settings.js';
import { ArticleService } from './article-service.js';
import { NodeIngestStorage } from '../ports/ingest-storage.js';
import { NodeBrewStorage } from '../ports/brew-storage.js';
import { nodeClock } from '../ports/runtime.js';
import { validateComposition } from '../../../../packages/core/src/composition-model.js';
import { sanitizeArticleHtml } from '../../../../packages/core/src/html-sanitizer.js';

interface SenderRow {
  id: number;
  title: string;
  url: string;
  settings: string;
  retention: number;
  unread: number;
  total: number;
  latest: number | null;
}
const settings = (row: SenderRow): NewsletterSettings => ({
  ...defaultNewsletterSettings(),
  ...JSON.parse(row.settings),
  retentionDays: row.retention,
});
const asSender = (row: SenderRow): NewsletterSender => ({
  id: row.id,
  title: row.title,
  address: row.url.slice('mailto:'.length),
  settings: settings(row),
  unreadCount: row.unread,
  letterCount: row.total,
  latestAt: row.latest === null ? null : new Date(row.latest).toISOString(),
});

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
        .all(current.settings.brewId ?? 0, updated.brewId ?? 0) as Array<{
        id: number;
        name: string;
      }>;
      if (
        (updated.brewId !== current.settings.brewId || patch.onlyInBrew === true) &&
        updated.brewId &&
        !configs.some((config) => config.id === updated.brewId)
      )
        throw new Error('That Brew no longer exists.');
      const affected =
        updated.retentionDays === current.settings.retentionDays
          ? []
          : (this.database.sqlite
              .prepare(
                'SELECT a.id,a.raw_html IS NOT NULL AS original,a.starred_at IS NULL AND NOT EXISTS(SELECT 1 FROM article_tags t WHERE t.article_id=a.id) AS discard FROM articles a WHERE a.feed_id=? AND a.published_at<? ORDER BY a.id',
              )
              .all(id, this.clock.now().getTime() - updated.retentionDays * 86_400_000) as Array<{
              id: number;
              original: number;
              discard: number;
            }>);
      const labels: Record<string, string> = {
        favorite: 'Favorite sender',
        skipInbox: 'Skip in Inbox',
        blocked: 'Block new mail',
        onlyInBrew: 'Only in Brew',
        retentionDays: 'Retention',
        brewId: 'Goes to Brew',
        cleaning: 'Cleaning overrides',
      };
      const describe = (key: string, value: unknown): string =>
        key === 'brewId'
          ? value
            ? (configs.find((config) => config.id === value)?.name ?? 'Brew unavailable')
            : 'No Brew'
          : key === 'retentionDays'
            ? `${value} ${value === 1 ? 'day' : 'days'}`
            : key === 'cleaning'
              ? 'Configured'
              : value
                ? 'On'
                : 'Off';
      const changes = Object.keys(patch)
        .filter(
          (key) =>
            JSON.stringify(current.settings[key as keyof NewsletterSettings] ?? null) !==
            JSON.stringify(updated[key as keyof NewsletterSettings] ?? null),
        )
        .map((key) => ({
          label: labels[key]!,
          before: describe(key, current.settings[key as keyof NewsletterSettings]),
          after:
            key === 'cleaning'
              ? 'Updated'
              : describe(key, updated[key as keyof NewsletterSettings]),
        }));
      const identity = this.database.sqlite
        .prepare('SELECT title,url,settings_json,retention_days FROM feeds WHERE id=?')
        .get(id);
      const revision = createHash('sha256')
        .update(
          JSON.stringify({
            id,
            patch,
            identity,
            affected,
            configs: 'brewId' in patch || patch.onlyInBrew === true ? configs : [],
          }),
        )
        .digest('hex');
      return {
        senderTitle: current.title,
        revision,
        changes,
        lettersRemoved: affected.reduce((sum, row) => sum + row.discard, 0),
        originalsRemoved: affected.reduce((sum, row) => sum + row.original, 0),
        requiresConfirmation: [
          'skipInbox',
          'blocked',
          'onlyInBrew',
          'retentionDays',
          'brewId',
        ].some((key) => key in patch),
        blocksMail: patch.blocked === true,
      };
    })();
  }
  private senders(id?: number): NewsletterSender[] {
    const rows = this.database.sqlite
      .prepare(
        `SELECT f.id,f.title,f.url,f.settings_json AS settings,f.retention_days AS retention,count(a.id) AS total,coalesce(sum(CASE WHEN a.id IS NOT NULL AND a.read_at IS NULL THEN 1 ELSE 0 END),0) AS unread,max(a.published_at) AS latest FROM feeds f LEFT JOIN articles a ON a.feed_id=f.id AND a.hidden=0 WHERE f.kind='newsletter' ${id === undefined ? '' : 'AND f.id=?'} GROUP BY f.id ORDER BY latest DESC,f.title COLLATE NOCASE,f.id`,
      )
      .all(...(id === undefined ? [] : [id])) as SenderRow[];
    return rows.map(asSender);
  }
  overview(): NewsletterOverview {
    const senders = this.senders();
    const counts = { inbox: 0, favorites: 0, skipped: 0, blocked: 0 };
    let unreadCount = 0;
    for (const sender of senders) {
      for (const view of ['inbox', 'favorites', 'skipped', 'blocked'] as const)
        if (senderInNewsletterView(sender.settings, view)) counts[view] += sender.letterCount;
      if (senderInNewsletterView(sender.settings, 'inbox')) unreadCount += sender.unreadCount;
    }
    return {
      senders,
      unreadCount,
      counts,
      brews: this.database.sqlite
        .prepare('SELECT id,name FROM brew_configs ORDER BY id')
        .all() as Array<{ id: number; name: string }>,
    };
  }
  letters(query: NewsletterLetterQuery): NewsletterLetterPage {
    const clauses = ["f.kind='newsletter'", 'a.hidden=0'];
    const params: number[] = [];
    const blocked = "coalesce(json_extract(f.settings_json,'$.blocked'),0)";
    const skipped = "coalesce(json_extract(f.settings_json,'$.skipInbox'),0)";
    if (query.view === 'blocked') clauses.push(`${blocked}=1`);
    else {
      clauses.push(`${blocked}<>1`);
      if (query.view === 'favorites') clauses.push("json_extract(f.settings_json,'$.favorite')=1");
      else clauses.push(`${skipped}${query.view === 'skipped' ? '=1' : '<>1'}`);
    }
    if (query.senderId !== undefined) {
      clauses.push('f.id=?');
      params.push(query.senderId);
    }
    const where = clauses.join(' AND ');
    const total = (
      this.database.sqlite
        .prepare(
          `SELECT count(*) AS n FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE ${where}`,
        )
        .get(...params) as { n: number }
    ).n;
    const pageSize = 50;
    const rows = this.database.sqlite
      .prepare(
        `SELECT a.id,f.id AS feedId,f.title AS feedTitle,a.title,substr(coalesce(a.summary_html,a.content_html,''),1,2500) AS excerpt,a.published_at AS publishedAt,a.read_at AS readAt,a.starred_at AS starredAt FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE ${where} ORDER BY a.published_at DESC,a.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, (query.page - 1) * pageSize) as Array<{
      id: number;
      feedId: number;
      feedTitle: string;
      title: string;
      excerpt: string;
      publishedAt: number;
      readAt: number | null;
      starredAt: number | null;
    }>;
    return {
      page: query.page,
      pageSize,
      total,
      items: rows.map((row) => ({
        ...row,
        excerpt: (
          parseHTML(`<html><body>${row.excerpt}</body></html>`).document.body.textContent ?? ''
        )
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 180),
        publishedAt: new Date(row.publishedAt).toISOString(),
        readAt: row.readAt === null ? null : new Date(row.readAt).toISOString(),
        starredAt: row.starredAt === null ? null : new Date(row.starredAt).toISOString(),
      })),
    };
  }
  letter(id: number): NewsletterLetter | null {
    const row = this.database.sqlite
      .prepare(
        "SELECT a.feed_id,a.cleaning_json,a.raw_html IS NOT NULL AS original FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE a.id=? AND f.kind='newsletter'",
      )
      .get(id) as { feed_id: number; cleaning_json: string | null; original: number } | undefined;
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
        this.database.sqlite
          .prepare(
            "SELECT a.raw_html AS html FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE a.id=? AND f.kind='newsletter'",
          )
          .get(id) as { html: string | null } | undefined
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
    if (nextId && !target) throw new Error('That Brew no longer exists.');
    const previous = previousId ? storage.composition(previousId) : null;
    if (previous) {
      const sections = newsletterBrewSections(previous.sections, id, false);
      if (JSON.stringify(sections) !== JSON.stringify(previous.sections)) {
        previous.sections = sections;
        validateComposition(previous);
        storage.updateComposition(previous.id, previous);
      }
    }
    if (
      target &&
      !target.sections.some((section) =>
        section.sources.some((source) => source.kind === 'feed' && source.id === id),
      )
    ) {
      target.sections = newsletterBrewSections(target.sections, id, true);
      validateComposition(target);
      storage.updateComposition(target.id, target);
    }
  }
}
