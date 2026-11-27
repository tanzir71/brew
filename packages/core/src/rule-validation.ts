import type { RuleDraft } from './types/rules.js';

export function validateRuleDraft(draft: RuleDraft): void {
  if (!draft.name.trim()) throw new Error('Rule name is required');
  if (!['all', 'any'].includes(draft.matchType)) throw new Error('Invalid match type');
  if (draft.conditions.length > 10) throw new Error('A rule may have at most 10 conditions');
  if (!draft.actions.length) throw new Error('Add at least one action');
  for (const condition of draft.conditions) {
    if (!condition.value.trim()) throw new Error('Condition values are required');
    if (condition.operator === 'matches_regex') {
      try {
        new RegExp(condition.value, 'iu');
      } catch {
        throw new Error(`Invalid regular expression: ${condition.value}`);
      }
    }
  }
}
