import { parseHTML } from 'linkedom';
import { updateNewsletterSettings } from './newsletter-settings.js';
import type {
  NewsletterSender,
  NewsletterSettings,
  NewsletterSettingsPatch,
} from './types/newsletters.js';
export interface NewsletterLetterRow {
  id: number;
  feedId: number;
  feedTitle: string;
  title: string;
  excerpt: string;
  publishedAt: number;
  readAt: number | null;
  starredAt: number | null;
}

export function senderPreviewPlan(
  current: NewsletterSender,
  patch: NewsletterSettingsPatch,
  configs: Array<Record<string, unknown> & { id: number; name: string }>,
  affected: Array<{ id: number; original: number; discard: number }>,
  identity: unknown,
) {
  const updated = updateNewsletterSettings(current.settings, patch);
  if (
    (updated.brewId !== current.settings.brewId || patch.onlyInBrew === true) &&
    updated.brewId &&
    !configs.some((config) => config.id === updated.brewId)
  )
    throw new Error('That Brew no longer exists.');
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
        key === 'cleaning' ? 'Updated' : describe(key, updated[key as keyof NewsletterSettings]),
    }));
  const revisionInput = JSON.stringify({
    id: current.id,
    patch,
    identity,
    affected,
    configs: 'brewId' in patch || patch.onlyInBrew === true ? configs : [],
  });
  const review = {
    senderTitle: current.title,
    changes,
    lettersRemoved: affected.reduce((sum, row) => sum + row.discard, 0),
    originalsRemoved: affected.reduce((sum, row) => sum + row.original, 0),
    requiresConfirmation: ['skipInbox', 'blocked', 'onlyInBrew', 'retentionDays', 'brewId'].some(
      (key) => key in patch,
    ),
    blocksMail: patch.blocked === true,
  };
  return { review, revisionInput };
}

export function newsletterLetters(rows: NewsletterLetterRow[]) {
  return rows.map((row) => ({
    ...row,
    excerpt: (parseHTML(`<html><body>${row.excerpt}</body></html>`).document.body.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180),
    publishedAt: new Date(row.publishedAt).toISOString(),
    readAt: row.readAt === null ? null : new Date(row.readAt).toISOString(),
    starredAt: row.starredAt === null ? null : new Date(row.starredAt).toISOString(),
  }));
}
export function senderPreviewReview(plan: ReturnType<typeof senderPreviewPlan>, revision: string) {
  const { senderTitle, ...details } = plan.review;
  return { senderTitle, revision, ...details };
}
