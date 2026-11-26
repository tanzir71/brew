import type { RuleAction, RuleCondition, RuleDraft } from './types/rules.js';

export type AgentWrite =
  | { kind: 'star_item'; id: number; starred: boolean }
  | { kind: 'tag_item'; id: number; add: string[]; remove: string[] }
  | { kind: 'add_feed'; url: string; folderId: number | null }
  | { kind: 'create_rule'; draft: RuleDraft };
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Choose an object.');
  return value as Record<string, unknown>;
};
const text = (value: unknown, max = 200): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error('Choose valid text.');
  return value.trim();
};
const identity = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new Error('Choose a valid item.');
  return value;
};
const boolean = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw new Error('Choose true or false.');
  return value;
};
const choice = <T extends string>(value: unknown, options: readonly T[]): T => {
  if (typeof value !== 'string' || !options.includes(value as T))
    throw new Error('Choose a supported value.');
  return value as T;
};
const list = <T>(value: unknown, parse: (item: unknown) => T, max: number): T[] => {
  if (!Array.isArray(value) || value.length > max) throw new Error('Choose a bounded list.');
  return value.map(parse);
};
export function agentRuleDraft(value: unknown): RuleDraft {
  const input = record(value);
  const scope = record(input.scope);
  const conditions = list(
    input.conditions,
    (value): RuleCondition => {
      const row = record(value);
      const result: RuleCondition = {
        field: choice(row.field, ['title', 'content', 'author', 'url', 'feed', 'folder']),
        operator: choice(row.operator, [
          'contains',
          'not_contains',
          'equals',
          'starts_with',
          'ends_with',
          'matches_regex',
        ]),
        value: text(row.value, 4000),
      };
      if (result.operator === 'matches_regex') new RegExp(result.value, 'iu');
      return result;
    },
    10,
  );
  const actions = list(
    input.actions,
    (value): RuleAction => {
      const row = record(value);
      const type = choice(row.type, [
        'add_tag',
        'remove_tag',
        'star',
        'mark_read',
        'hide',
        'highlight',
        'feature_in_brew',
        'exclude_from_brew',
        'notify',
        'webhook',
      ]);
      if (type === 'add_tag' || type === 'remove_tag') return { type, tag: text(row.tag, 100) };
      if (type === 'highlight') return { type, color: text(row.color, 100) };
      if (type === 'webhook') {
        const url = new URL(text(row.url, 8000));
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Choose an HTTP webhook.');
        return { type, url: url.href };
      }
      return { type };
    },
    20,
  );
  if (!actions.length) throw new Error('Add at least one action.');
  return {
    name: text(input.name),
    enabled: boolean(input.enabled),
    matchType: choice(input.matchType, ['all', 'any']),
    scope: {
      ...(scope.feedIds === undefined
        ? {}
        : { feedIds: [...new Set(list(scope.feedIds, identity, 500))].sort((a, b) => a - b) }),
      ...(scope.folderIds === undefined
        ? {}
        : { folderIds: [...new Set(list(scope.folderIds, identity, 500))].sort((a, b) => a - b) }),
    },
    conditions,
    actions,
    stopProcessing: boolean(input.stopProcessing),
  };
}
export function agentWrite(input: Record<string, unknown>): AgentWrite | null {
  if (input.kind === 'star_item')
    return { kind: input.kind, id: identity(input.id), starred: boolean(input.starred) };
  if (input.kind === 'tag_item') {
    const names = (value: unknown) =>
      [...new Set(list(value ?? [], (name) => text(name, 100), 50))].sort();
    const add = names(input.add),
      remove = names(input.remove);
    if (!add.length && !remove.length) throw new Error('Choose tags to add or remove.');
    if (add.some((name) => remove.includes(name)))
      throw new Error('A tag cannot be added and removed together.');
    return { kind: input.kind, id: identity(input.id), add, remove };
  }
  if (input.kind === 'add_feed') {
    const url = new URL(text(input.url, 8000));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Choose an HTTP feed URL.');
    url.hash = '';
    return {
      kind: input.kind,
      url: url.href,
      folderId:
        input.folderId === undefined || input.folderId === null ? null : identity(input.folderId),
    };
  }
  if (input.kind === 'create_rule') return { kind: input.kind, draft: agentRuleDraft(input.draft) };
  return null;
}
