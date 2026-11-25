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
