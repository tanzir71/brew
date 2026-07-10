export type BrewSource = 'folder' | 'feed' | 'tag' | 'starred' | 'featured' | 'today' | 'weekly_review';
export type BrewLayout = 'hero' | 'list' | 'magazine';
export interface BrewSection {
  id: string; title: string; divider?: string; source: BrewSource; sourceId?: number;
  maxItems: number; layout: BrewLayout; sort: 'newest' | 'longest'; onlyUnread: boolean;
}
export interface BrewConfig { id:number; name:string; scheduleCron:string; enabled:boolean; sections:BrewSection[]; createdAt:string }
export type BrewConfigDraft = Omit<BrewConfig, 'id' | 'createdAt'>;
export interface BrewItem { id:number; title:string; url:string; author:string|null; summaryHtml:string|null; imageUrl:string|null; publishedAt:string; feedTitle:string; readTimeMinutes:number; readAt:string|null }
export interface BrewSnapshotSection extends BrewSection { items:BrewItem[] }
export interface BrewSnapshot { id:number; brewConfigId:number; configName:string; generatedAt:string; sections:BrewSnapshotSection[]; scrollPosition:number }
