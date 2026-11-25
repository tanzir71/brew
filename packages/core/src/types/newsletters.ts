import type { ArticleDetail } from './api.js';

export interface NewsletterCleaning {
  trackers: number;
  sponsorBlocks: number;
  footerTrimmed: boolean;
}

export interface NewsletterSelectors {
  sponsorSelectors?: string[];
  footerSelectors?: string[];
}

export interface NewsletterSettings {
  favorite: boolean;
  skipInbox: boolean;
  blocked: boolean;
  brewId?: number;
  onlyInBrew: boolean;
  retentionDays: number;
  cleaning?: NewsletterSelectors;
}

export const defaultNewsletterSettings = (): NewsletterSettings => ({
  favorite: false,
  skipInbox: false,
  blocked: false,
  onlyInBrew: false,
  retentionDays: 90,
});

/** A decoded message, also usable by JSON inbound adapters. No attachments are retained. */
export interface NewsletterMessage {
  from: { address: string; name?: string };
  subject?: string;
  messageId?: string;
  date?: string;
  html?: string;
  text?: string;
  archiveUrl?: string;
}

export interface NewsletterFeed {
  id: number;
  retentionDays: number;
  settings: NewsletterSettings;
}

export type NewsletterIngestResult = {
  feedId: number;
  articleId: number | null;
  outcome: 'inserted' | 'duplicate' | 'blocked';
};

export type NewsletterView = 'inbox' | 'favorites' | 'skipped' | 'blocked';
export interface NewsletterSender {
  id: number;
  title: string;
  address: string;
  settings: NewsletterSettings;
  unreadCount: number;
  letterCount: number;
  latestAt: string | null;
}
export interface NewsletterOverview {
  senders: NewsletterSender[];
  unreadCount: number;
  counts: Record<NewsletterView, number>;
  brews: Array<{ id: number; name: string }>;
}
export interface NewsletterLetterSummary {
  id: number;
  feedId: number;
  feedTitle: string;
  title: string;
  excerpt: string;
  publishedAt: string;
  readAt: string | null;
  starredAt: string | null;
}
export interface NewsletterLetterPage {
  items: NewsletterLetterSummary[];
  total: number;
  page: number;
  pageSize: number;
}
export interface NewsletterLetter extends ArticleDetail {
  sender: NewsletterSender;
  cleaning: NewsletterCleaning | null;
  originalAvailable: boolean;
}
export interface NewsletterLetterQuery {
  view: NewsletterView;
  senderId?: number;
  page: number;
}
export type NewsletterSettingsPatch = Partial<Omit<NewsletterSettings, 'brewId'>> & {
  brewId?: number | null;
};

export const senderInNewsletterView = (
  settings: NewsletterSettings,
  view: NewsletterView,
): boolean =>
  view === 'blocked'
    ? settings.blocked
    : !settings.blocked &&
      (view === 'favorites'
        ? settings.favorite
        : view === 'skipped'
          ? settings.skipInbox
          : !settings.skipInbox);
