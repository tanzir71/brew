export type RuleField = 'title' | 'content' | 'author' | 'url' | 'feed' | 'folder';
export type RuleOperator =
  'contains' | 'not_contains' | 'equals' | 'starts_with' | 'ends_with' | 'matches_regex';
export interface RuleCondition {
  field: RuleField;
  operator: RuleOperator;
  value: string;
}
export type RuleAction =
  | { type: 'add_tag'; tag: string }
  | { type: 'remove_tag'; tag: string }
  | { type: 'star' }
  | { type: 'mark_read' }
  | { type: 'hide' }
  | { type: 'highlight'; color: string }
  | { type: 'feature_in_brew' }
  | { type: 'exclude_from_brew' }
  | { type: 'notify' }
  | { type: 'webhook'; url: string };
export interface RuleScope {
  feedIds?: number[];
  folderIds?: number[];
}
export interface RuleRecord {
  id: number;
  name: string;
  enabled: boolean;
  position: number;
  matchType: 'all' | 'any';
  scope: RuleScope;
  conditions: RuleCondition[];
  actions: RuleAction[];
  stopProcessing: boolean;
}
export type RuleDraft = Omit<RuleRecord, 'id' | 'position'> & { position?: number };
export interface RulePreviewItem {
  id: number;
  title: string;
  feedTitle: string;
  publishedAt: string;
}
