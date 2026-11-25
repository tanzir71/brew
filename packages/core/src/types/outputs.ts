import type { BrewDepth, BrewLayout } from './composition.js';

export interface BrewOutputOptions {
  /** Instance origin for absolute links/proxied images in externally consumed output. */
  baseUrl?: string;
}

/** Content-only twin. Mutable reading state, source queries and delivery settings stay private. */
export interface BrewIssueDocument {
  version: 2;
  id: number;
  brewConfigId: number;
  issueNumber: number;
  configName: string;
  generatedAt: string;
  timezone: string;
  sections: Array<{
    id: string;
    kind: 'items' | 'note' | 'divider';
    title: string;
    layout: BrewLayout;
    depth: BrewDepth;
    images: boolean;
    noteHtml?: string;
    items: Array<{
      id: number;
      title: string;
      url: string | null;
      author: string | null;
      publishedAt: string;
      feedTitle: string;
      readTimeMinutes: number;
      imageUrl: string | null;
      summaryHtml: string | null;
      contentHtml?: string | null;
    }>;
  }>;
}

export interface BrewFeedInfo {
  id: number;
  name: string;
  /** Deterministic fallback for an empty archive; usually the config creation time. */
  updatedAt: string;
}

export interface BrewOutputs {
  web: string;
  email: string;
  text: string;
  markdown: string;
  json: string;
  /** Atom, kept as `feed` for compatibility with the Compose preview. */
  feed: string;
  jsonFeed: string;
}
