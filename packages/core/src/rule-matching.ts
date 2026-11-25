import type { ArticleContext, RegexPort } from './ports.js';
import type { RuleCondition } from './types/rules.js';
import { safeRegexTest } from './safe-regex.js';
const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase();
export async function matchCondition(
  regex: RegexPort,
  context: ArticleContext,
  condition: RuleCondition,
): Promise<boolean> {
  const value = String(context[condition.field] ?? '');
  const source = normalized(value);
  const target = normalized(condition.value);
  switch (condition.operator) {
    case 'contains':
      return source.includes(target);
    case 'not_contains':
      return !source.includes(target);
    case 'equals':
      return source === target;
    case 'starts_with':
      return source.startsWith(target);
    case 'ends_with':
      return source.endsWith(target);
    case 'matches_regex':
      return (await safeRegexTest(regex, condition.value, value)).matched;
  }
}
export async function matchingContexts<T extends ArticleContext>(
  rows: T[],
  filter: { match: 'all' | 'any'; conditions: RuleCondition[] } | undefined,
  regex: RegexPort,
): Promise<T[]> {
  if (!filter?.conditions.length) return rows;
  const matches = rows.map(() => filter.match === 'all');
  for (const condition of filter.conditions) {
    let values: boolean[];
    if (condition.operator === 'matches_regex' && regex.testMany) {
      const result = await regex.testMany(
        condition.value,
        rows.map((row) => String(row[condition.field] ?? '')),
        500,
      );
      if (result.error || result.timedOut)
        throw new Error(result.error ?? 'Regular expression timed out.');
      values = result.matches;
    } else if (condition.operator === 'matches_regex') {
      values = [];
      for (const row of rows) {
        const result = await safeRegexTest(
          regex,
          condition.value,
          String(row[condition.field] ?? ''),
        );
        if (result.error || result.timedOut)
          throw new Error(result.error ?? 'Regular expression timed out.');
        values.push(result.matched);
      }
    } else values = await Promise.all(rows.map((row) => matchCondition(regex, row, condition)));
    for (let index = 0; index < rows.length; index++)
      matches[index] =
        filter.match === 'all'
          ? matches[index]! && !!values[index]
          : matches[index]! || !!values[index];
  }
  return rows.filter((_, index) => matches[index]);
}
