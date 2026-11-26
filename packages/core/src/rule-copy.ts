import type { RuleDraft, RuleRecord } from './types/rules.js';

/** Bind Copy to the saved definition, independently of log counters or key order. */
export function ruleCopySource(rule: RuleRecord): string {
  const { id, name, enabled, position, matchType, scope, conditions, actions, stopProcessing } =
    rule;
  return JSON.stringify(
    { id, name, enabled, position, matchType, scope, conditions, actions, stopProcessing },
    (_key, value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
        : value,
  );
}
export function copiedRuleDraft(rule: RuleRecord): RuleDraft {
  return {
    name: `${rule.name} copy`,
    enabled: false,
    matchType: rule.matchType,
    scope: structuredClone(rule.scope),
    conditions: structuredClone(rule.conditions),
    actions: structuredClone(rule.actions),
    stopProcessing: rule.stopProcessing,
  };
}
