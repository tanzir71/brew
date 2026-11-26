export type ReadActionTarget =
  | { kind: 'items'; ids: number[] }
  | { kind: 'reader'; view: 'all' | 'today' | 'starred'; feedId?: number; folderId?: number };
export interface ReadActionPreview {
  revision: string;
  updated: number;
  unavailable: number;
}
const validId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
export function readActionTarget(value: unknown): ReadActionTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Choose a read scope.');
  const input = value as Record<string, unknown>;
  if (input.kind === 'items') {
    if (
      Object.keys(input).some((key) => !['kind', 'ids'].includes(key)) ||
      !Array.isArray(input.ids) ||
      !input.ids.length ||
      input.ids.length > 50_000 ||
      !input.ids.every(validId)
    )
      throw new Error('Choose 1–50000 valid article IDs.');
    return { kind: 'items', ids: [...new Set(input.ids as number[])].sort((a, b) => a - b) };
  }
  if (
    input.kind !== 'reader' ||
    Object.keys(input).some((key) => !['kind', 'view', 'feedId', 'folderId'].includes(key)) ||
    !['all', 'today', 'starred'].includes(String(input.view)) ||
    (input.feedId !== undefined && !validId(input.feedId)) ||
    (input.folderId !== undefined && !validId(input.folderId)) ||
    (input.feedId !== undefined && input.folderId !== undefined)
  )
    throw new Error('Choose a valid Reader scope.');
  return {
    kind: 'reader',
    view: input.view as 'all' | 'today' | 'starred',
    ...(input.feedId === undefined ? {} : { feedId: input.feedId as number }),
    ...(input.folderId === undefined ? {} : { folderId: input.folderId as number }),
  };
}
