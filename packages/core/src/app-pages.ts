/** URL helpers stay separate from server rendering so discovery adds no HTML parser to the UI. */
export const isAppPageOutputPath = (path: string) =>
  /^\/(index|reader|feeds|letters|rules)\.(md|json)$/.test(path) ||
  /^\/rules\/[^/]+\.(md|json)$/.test(path) ||
  /^\/settings\/runs\.(md|json)$/.test(path) ||
  /^\/b\/[^/]+\/(compose|read)\.(md|json)$/.test(path);
export const readerWelcomeCopy = {
  title: 'The Brew',
  heading: 'A calmer way to catch up.',
  description:
    'Your frozen daily Brew will appear here. Until then, Today gathers the last 24 hours.',
};
export class PageInputError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 501 = 400,
  ) {
    super(message);
  }
}
export function pageId(value: string): number {
  const id = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id))
    throw new PageInputError('Page not found.', 404);
  return id;
}
export function pageChoice<T extends string>(
  value: string | null,
  choices: readonly T[],
  fallback: T,
): T {
  if (value === null) return fallback;
  if (!choices.includes(value as T)) throw new PageInputError('Invalid page filter.');
  return value as T;
}
export function pageNumber(value: string | null) {
  if (value === null) return 1;
  if (
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > 1_000_000
  )
    throw new PageInputError('Invalid page number.');
  return Number(value);
}
export function rulePageLocation(url: URL): { id: number | null; tab: 'preview' | 'log' } {
  const match = /^\/rules(?:\/([^/]+))?$/.exec(url.pathname);
  const legacy = url.pathname === '/' && url.searchParams.get('view') === 'rules';
  if (!match && !legacy) return { id: null, tab: 'preview' };
  return {
    id: match?.[1] ? pageId(match[1]) : null,
    tab: pageChoice(url.searchParams.get('tab'), ['preview', 'log'], 'preview'),
  };
}
export const rulePageHref = (id: number | null, tab: 'preview' | 'log' = 'preview') =>
  `/rules${id === null ? '' : `/${id}`}${tab === 'log' ? '?tab=log' : ''}`;
export const newsletterListHref = (state: {
  view: string;
  senderId: number | null;
  page: number;
  sort: string;
}) => {
  const params = new URLSearchParams();
  if (state.view !== 'inbox') params.set('view', state.view);
  if (state.senderId !== null) params.set('sender', String(state.senderId));
  if (state.page > 1) params.set('page', String(state.page));
  if (state.sort !== 'recent') params.set('sort', state.sort);
  return `/letters${params.size ? `?${params}` : ''}`;
};
