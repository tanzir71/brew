import type { TagChanges } from './types/api.js';

export function parseTagChanges(input: unknown): TagChanges {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Choose tags to add or remove.');
  const value = input as Record<string, unknown>;
  const keys = Object.keys(value);
  if (!keys.length || keys.some((key) => key !== 'add' && key !== 'remove'))
    throw new Error('Choose tags to add or remove.');
  const ids = (field: 'add' | 'remove') => {
    const items = value[field] === undefined ? [] : value[field];
    if (
      !Array.isArray(items) ||
      items.length > 500 ||
      !items.every((id) => Number.isSafeInteger(id) && id > 0)
    )
      throw new Error('Choose up to 500 valid tags to add or remove.');
    return [...new Set(items as number[])].sort((a, b) => a - b);
  };
  const add = ids('add');
  const remove = ids('remove');
  if (add.some((id) => remove.includes(id)))
    throw new Error('A tag cannot be added and removed together.');
  return { add, remove };
}
