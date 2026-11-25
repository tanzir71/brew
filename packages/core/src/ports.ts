import type { ArticleSummary } from './types/api.js';
import type { BrewConfig, BrewConfigDraft, BrewItem, BrewSnapshot } from './types/legacy-brew.js';
import type { RuleAction, RuleDraft, RuleLogRecord, RuleRecord } from './types/rules.js';

export interface ClockPort {
  now(): Date;
  monotonic(): number;
}
export interface FetchPort {
  fetch: typeof globalThis.fetch;
}
export interface HashPort {
  sha1(value: string): string;
}
export interface RegexResult {
  matched: boolean;
  timedOut: boolean;
  error?: string;
}
export interface RegexPort {
  test(pattern: string, value: string, timeoutMs?: number): Promise<RegexResult>;
  testMany?(
    pattern: string,
    values: string[],
    timeoutMs?: number,
  ): Promise<{ matches: boolean[]; timedOut: boolean; error?: string }>;
}
export interface NotificationPort {
  notify(article: { id: number; title: string; url: string }): void;
}

export interface ArticleContext {
  id: number;
  title: string;
  content: string;
  author: string;
  url: string;
  feedId: number;
  feed: string;
  folderId: number | null;
  folder: string;
}
export interface ArticleChanges {
  starredAt?: Date;
  readAt?: Date;
  hidden?: boolean;
  highlightColor?: string;
  featuredInBrew?: boolean;
  excludedFromBrew?: boolean;
}
export interface ActionResult {
  type: RuleAction['type'];
  ok: boolean;
  error?: string;
}
export interface RuleStoragePort {
  context(id: number): ArticleContext | null;
  definitions(): RuleRecord[];
  list(now: Date): RuleRecord[];
  create(draft: RuleDraft & { position: number }): number;
  update(id: number, draft: RuleDraft, now: Date): boolean;
  delete(id: number): boolean;
  addTag(articleId: number, name: string): void;
  removeTag(articleId: number, name: string): void;
  updateArticle(id: number, changes: ArticleChanges): void;
  log(ruleId: number, articleId: number, results: ActionResult[]): void;
  logs(ruleId: number): RuleLogRecord[];
  articleIds(options: { since?: number; visibleOnly?: boolean }): number[];
  publishedAt(articleId: number): Date;
}
export interface BrewStoragePort {
  listConfigs(): BrewConfig[];
  create(draft: BrewConfigDraft): number;
  update(id: number, draft: BrewConfigDraft): boolean;
  delete(id: number): boolean;
  items(query: BrewItemQuery): BrewItemRow[];
  save(
    configId: number,
    payload:
      | Pick<BrewSnapshot, 'configName' | 'sections'>
      | Omit<import('./types/brew.js').BrewSnapshot, 'id' | 'brewConfigId' | 'scrollPosition'>,
  ): number;
  prune(configId: number, keep: number): void;
  pruneBefore(configId: number, before: number): void;
  historyIds(configId: number): number[];
  snapshot(id: number): import('./types/brew.js').BrewIssue | null;
  composition(id: number): import('./types/brew.js').BrewConfig | null;
  createComposition(draft: import('./types/brew.js').BrewConfigDraft): number;
  updateComposition(id: number, draft: import('./types/brew.js').BrewConfigDraft): boolean;
  usesComposition(id: number): boolean;
  nextIssueNumber(id: number): number;
  savedSourceSearch(id: number): { query: string } | undefined;
  compositionItems(query: BrewItemQuery): BrewCandidate[];
  articleStates(ids: number[]): import('./types/legacy-brew.js').BrewArticleState[];
  setting(key: string): string | undefined;
  setSetting(key: string, value: string): void;
}
export type BrewPreviewStoragePort = Pick<
  BrewStoragePort,
  'compositionItems' | 'savedSourceSearch' | 'nextIssueNumber'
>;
export interface BrewItemQuery {
  onlyUnread: boolean;
  searchQuery?: string;
  folderId?: number;
  feedId?: number;
  tagId?: number;
  starred: boolean;
  featured: boolean;
  publishedSince?: number;
  sort: 'newest' | 'oldest' | 'longest';
  limit?: number;
}
export interface BrewCandidate extends ArticleContext {
  summaryHtml: string | null;
  imageUrl: string | null;
  body: string | null;
  publishedAt: number;
  readAt: number | null;
}
export type BrewItemRow = Omit<BrewItem, 'publishedAt' | 'readAt' | 'readTimeMinutes'> & {
  publishedAt: number;
  readAt: number | null;
  body: string | null;
};
export interface StoredArticle {
  feedId: number;
  guid: string;
  url: string;
  title: string;
  author: string | null;
  summaryHtml: string | null;
  contentHtml: string | null;
  imageUrl: string | null;
  enclosureUrl: string | null;
  enclosureType: string | null;
  publishedAt: Date;
  hash: string;
}
export interface IngestCandidate {
  feedId: number;
  guid: string;
  hash: string;
  prepare(): StoredArticle;
}
export interface IngestStoragePort {
  insertBatch(items: IngestCandidate[]): number[];
  duplicateFilterEnabled(): boolean;
  title(id: number): string;
  recentTitles(excludeId: number, since: number): string[];
  hide(id: number): void;
  prune(feedId: number, before: number): void;
}
export type SearchScope = 'all' | 'folder' | 'starred';
export interface SearchOptions {
  folderId?: number;
  limit?: number;
  offset?: number;
}
export type SearchRow = Omit<ArticleSummary, 'publishedAt' | 'readAt' | 'starredAt'> & {
  publishedAt: number;
  readAt: number | null;
  starredAt: number | null;
};
export interface SearchPort {
  search(
    query: string,
    scope: SearchScope,
    options: SearchOptions & { limit: number; offset: number },
  ): SearchRow[];
}
