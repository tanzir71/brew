export type RuleField = 'title' | 'content' | 'author' | 'url' | 'feed' | 'folder';
export type RuleOperator = 'contains' | 'not_contains' | 'equals' | 'starts_with' | 'ends_with' | 'matches_regex';
export interface RuleCondition { field: RuleField; operator: RuleOperator; value: string }
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
export interface RuleScope { feedIds?: number[]; folderIds?: number[] }
