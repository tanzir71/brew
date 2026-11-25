import type { RuleCondition } from './rules.js';
import type { BrewOutputs } from './outputs.js';
export type { BrewItem, BrewArticleState, BrewReadState } from './legacy-brew.js';
import type { BrewItem } from './legacy-brew.js';
import type { NewsletterCleaning } from './newsletters.js';

export type BrewLayout = 'lead' | 'magazine' | 'grid' | 'headlines';
export type BrewDepth = 'title' | 'excerpt' | 'full' | 'brief';
export interface BrewSourceRef {
  kind:
    | 'folder'
    | 'feed'
    | 'tag'
    | 'starred'
    | 'featured'
    | 'today'
    | 'weekly_review'
    | 'newsletters'
    | 'saved_search';
  id?: number;
  /** Newsletter sources match any chosen sender or tag; omitted selectors mean all senders. */
  senderIds?: number[];
  tagIds?: number[];
}
export interface BrewSection {
  id: string;
  kind: 'items' | 'note' | 'divider';
  title: string;
  sources: BrewSourceRef[];
  maxItems: number;
  layout: BrewLayout;
  depth: BrewDepth;
  images: boolean;
  onlyUnread: boolean;
  sort: 'newest' | 'oldest' | 'longest';
  filter?: { match: 'all' | 'any'; conditions: RuleCondition[] };
  days?: number[];
  note?: string;
}
export interface BrewSchedule {
  kind: 'daily' | 'weekdays' | 'weekly' | 'monthly';
  days?: number[];
  dayOfMonth?: number;
  time: string;
  skipIfFewerThan?: number;
}
export interface BrewDelivery {
  web: true;
  feed: boolean;
  email?: { to: string };
  webhook?: { url: string };
  publicCopy: boolean;
}
export interface BrewConfig {
  id: number;
  name: string;
  enabled: boolean;
  createdAt: string;
  scheduleCron: string;
  timezone: string;
  schedule: BrewSchedule;
  delivery: BrewDelivery;
  sections: BrewSection[];
}
export type BrewConfigDraft = Omit<BrewConfig, 'id' | 'createdAt' | 'scheduleCron'>;
export type BrewSnapshotItem = BrewItem & {
  feedId?: number;
  contentHtml?: string | null;
  newsletter?: { cleaning: NewsletterCleaning | null };
};
export interface BrewSnapshotSection extends BrewSection {
  items: BrewSnapshotItem[];
  matchingItems: number;
  eligibleItems: number;
  noteHtml?: string;
}
export interface BrewSnapshot {
  version: 2;
  id: number;
  issueNumber: number;
  brewConfigId: number;
  configName: string;
  generatedAt: string;
  timezone: string;
  sections: BrewSnapshotSection[];
  scrollPosition: number;
}
export type BrewIssue = BrewSnapshot | import('./legacy-brew.js').BrewSnapshot;
export interface BrewPreview {
  snapshot: BrewSnapshot;
  outputs: BrewOutputs;
  warnings: string[];
}
