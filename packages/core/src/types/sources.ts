import type { FeedCandidate } from './api.js';
export interface SourceCandidate extends FeedCandidate {
  cadence?: string;
}
export interface SourceDiscovery {
  inputUrl: string;
  kind: 'web' | 'youtube' | 'subreddit' | 'mastodon' | 'bluesky' | 'podcast';
  candidates: SourceCandidate[];
  newsletter?: { title: string };
  notice?: string;
}
export interface SavedSourceSearch {
  id: number;
  clientId: string;
  name: string;
  query: string;
}
export interface SourceMailbox {
  address: string | null;
}
