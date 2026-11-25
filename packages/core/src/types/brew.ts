export type BrewSource =
  'folder' | 'feed' | 'tag' | 'starred' | 'featured' | 'today' | 'weekly_review';
// Legacy layout names remain readable until the v2 config migration.
export type BrewLayout = 'lead' | 'magazine' | 'grid' | 'headlines' | 'hero' | 'list';
export interface BrewSection {
  id: string;
  title: string;
  divider?: string;
  source: BrewSource;
  sourceId?: number;
  maxItems: number;
  layout: BrewLayout;
  sort: 'newest' | 'longest';
  onlyUnread: boolean;
}
export interface BrewConfig {
  id: number;
  name: string;
  scheduleCron: string;
  enabled: boolean;
  sections: BrewSection[];
  createdAt: string;
}
export type BrewConfigDraft = Omit<BrewConfig, 'id' | 'createdAt'>;
export interface BrewItem {
  id: number;
  title: string;
  url: string;
  author: string | null;
  summaryHtml: string | null;
  imageUrl: string | null;
  publishedAt: string;
  feedTitle: string;
  readTimeMinutes: number;
  readAt: string | null;
}
export interface BrewSnapshotSection extends BrewSection {
  items: BrewItem[];
}
export interface BrewSnapshot {
  id: number;
  brewConfigId: number;
  configName: string;
  generatedAt: string;
  sections: BrewSnapshotSection[];
  scrollPosition: number;
}
export interface BrewArticleState {
  id: number;
  feedId: number | null;
  available: boolean;
  readAt: string | null;
  starredAt: string | null;
  highlightColor: string | null;
  rules: Array<{ id: number; name: string }>;
}
export interface BrewReadState {
  articles: BrewArticleState[];
  timeZone: string;
  nextAt: string | null;
  scheduleLabel: string;
}
