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
