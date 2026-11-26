import type { OutboundMailPort } from '../../core/src/types/delivery.js';
import type {
  SourceDiscovery,
  SavedSourceSearch,
  SourceMailbox,
} from '../../core/src/types/sources.js';
import type {
  ArticleDetail,
  ArticlePage,
  FeedCandidate,
  FeedSummary,
  FolderSummary,
  HiddenArticlePage,
  MarkAllReadResult,
  ReaderNavigation,
  TagSummary,
} from '../../core/src/types/api.js';
import type { BrewService } from '../../core/src/brew-service.js';
import type { RulesService } from '../../core/src/rules-service.js';
import type { SearchService } from '../../core/src/search-service.js';
import type { Capabilities } from '../../core/src/types/capabilities.js';
import type { InboundEmailPort } from './inbound.js';
import type {
  NewsletterOverview,
  NewsletterSender,
  NewsletterLetterQuery,
  NewsletterLetterPage,
  NewsletterLetter,
} from '../../core/src/types/newsletters.js';

type MaybePromise<T> = T | Promise<T>;
type ServicePort<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => MaybePromise<Awaited<R>>
    : never;
};
export type ReaderView = 'all' | 'today' | 'starred';
export interface ArticleQuery {
  includeTotal?: boolean;
  offset?: number;
  view: ReaderView;
  feedId?: number;
  folderId?: number;
  limit?: number;
  unread?: boolean;
  sort?: 'newest' | 'oldest';
  cursor?: string;
}
export interface MarkAllScope {
  view: ReaderView;
  feedId?: number;
  folderId?: number;
}
export interface FeedApiPort {
  listFeeds(): MaybePromise<FeedSummary[]>;
  listFolders(): MaybePromise<FolderSummary[]>;
  discover(url: string): Promise<FeedCandidate[]>;
  add(url: string, folderId: number | null): Promise<FeedSummary>;
  renameFeed(
    id: number,
    title: string,
    folderId?: number | null,
  ): MaybePromise<FeedSummary | undefined>;
  deleteFeed(id: number): MaybePromise<boolean>;
  setRetention(id: number, days: number): MaybePromise<FeedSummary | undefined>;
  createFolder(title: string): MaybePromise<FolderSummary>;
  renameFolder(id: number, title: string): MaybePromise<FolderSummary | undefined>;
  deleteFolder(id: number): MaybePromise<boolean>;
}
export interface ArticleApiPort {
  get(id: number): MaybePromise<ArticleDetail | null>;
  extractFullText(id: number): Promise<ArticleDetail | null>;
  updateState(
    id: number,
    values: { read?: boolean; starred?: boolean },
  ): MaybePromise<ArticleDetail | null>;
  listTags(): MaybePromise<TagSummary[]>;
  createTag(name: string, color?: string): MaybePromise<TagSummary>;
  setTags(id: number, tagIds: number[]): MaybePromise<ArticleDetail | null>;
  markAllRead(scope: MarkAllScope): MaybePromise<MarkAllReadResult>;
  undoMarkAll(token: string): MaybePromise<number | null>;
}
export interface ApiDataPort {
  hiddenArticles(): MaybePromise<
    Array<{ id: number; title: string; feedTitle: string; publishedAt: number }>
  >;
  hiddenArticlePage(page: number): MaybePromise<HiddenArticlePage>;
  unhideArticle(id: number): MaybePromise<boolean>;
  duplicateFilterEnabled(): MaybePromise<boolean>;
  setDuplicateFilter(enabled: boolean): MaybePromise<void>;
}
export interface EventsPort {
  subscribe(listener: (event: string, data: unknown) => void, onClose: () => void): () => void;
}
export interface ApiServices {
  actions?: import('../../core/src/actions.js').ActionsService;
  outputBaseUrl?: string;
  newsletters?: {
    overview(): MaybePromise<NewsletterOverview>;
    letters(query: NewsletterLetterQuery): MaybePromise<NewsletterLetterPage>;
    letter(id: number): MaybePromise<NewsletterLetter | null>;
    original(id: number): MaybePromise<string | null>;
    updateSender(id: number, patch: unknown): MaybePromise<NewsletterSender | null>;
    previewSenderSettings(id: number, patch: unknown): MaybePromise<import('../../core/src/types/newsletters.js').SenderSettingsPreview | null>;
  };
  inboundEmail?: InboundEmailPort;
  outboundMail?: OutboundMailPort;
  sources: {
    discover(url: string): Promise<SourceDiscovery>;
    searches(): MaybePromise<SavedSourceSearch[]>;
    saveSearch(value: {
      clientId: string;
      name: string;
      query: string;
    }): MaybePromise<SavedSourceSearch>;
    mailbox(): MaybePromise<SourceMailbox>;
  };
  capabilities(): MaybePromise<Capabilities>;
  feeds: FeedApiPort;
  articles: ArticleApiPort;
  reader: {
    navigation(): MaybePromise<ReaderNavigation>;
    articles(query: ArticleQuery): MaybePromise<ArticlePage>;
  };
  brews: ServicePort<BrewService>;
  rules: ServicePort<RulesService>;
  search: ServicePort<SearchService>;
  opml: {
    preview(xml: string): MaybePromise<import('../../core/src/opml.js').OpmlPreview>;
    import(
      xml: string,
    ): MaybePromise<{ imported: number; skipped: number; foldersCreated: number }>;
    export(): MaybePromise<string>;
  };
  poller: {
    pollFeedById(id: number): Promise<{
      feedId: number;
      status: number;
      newItems: number;
      outcome: 'success' | 'not-modified' | 'error';
      error?: string;
    } | null>;
  };
  data: ApiDataPort;
  events: EventsPort;
  fetcher: typeof fetch;
}
