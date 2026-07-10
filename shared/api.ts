export interface HealthResponse { ok: true }

export interface FeedSummary {
  id: number;
  folderId: number | null;
  url: string;
  siteUrl: string | null;
  title: string;
  description: string | null;
  fetchIntervalMinutes: number;
  lastFetchedAt: string | null;
  lastStatus: number | null;
  consecutiveFailures: number;
  failingSince: string | null;
  healthWarning: boolean;
}

export interface FolderSummary { id: number; title: string; position: number }

export interface FeedCandidate { url: string; title: string; type: 'rss' | 'atom' | 'json' }

export interface ReaderFeed { id: number; folderId: number | null; title: string; unreadCount: number; muted: boolean }
export interface ReaderFolder { id: number; title: string; unreadCount: number; feeds: ReaderFeed[] }
export interface ReaderNavigation {
  counts: { all: number; today: number; starred: number };
  folders: ReaderFolder[];
  unfiled: ReaderFeed[];
}

export interface ArticleSummary {
  id: number;
  url: string;
  title: string;
  author: string | null;
  summaryHtml: string | null;
  imageUrl: string | null;
  publishedAt: string;
  readAt: string | null;
  starredAt: string | null;
  feedId: number;
  feedTitle: string;
  folderId: number | null;
  folderTitle: string | null;
}
export interface ArticlePage { items: ArticleSummary[]; nextCursor: string | null }
export interface ArticleDetail extends ArticleSummary {
  contentHtml: string | null;
  fullTextHtml: string | null;
  readTimeMinutes: number;
  tags: TagSummary[];
}
export interface TagSummary { id: number; name: string; color: string }
export interface MarkAllReadResult { updated: number; undoToken: string; expiresAt: string }
