/** URL helpers stay separate from server rendering so discovery adds no HTML parser to the UI. */
import type { NewsletterSender, NewsletterView } from './types/newsletters.js';

export const isAppPageOutputPath = (path: string) =>
  /^\/(index|reader|feeds|letters|rules)\.(md|json)$/.test(path) ||
  /^\/rules\/[^/]+\.(md|json)$/.test(path) ||
  /^\/letters\/[^/]+(?:\/[^/]+)?\.(md|json)$/.test(path) ||
  /^\/settings\/(runs|agents)\.(md|json)$/.test(path) ||
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
export interface FeedLibraryLocation {
  section: 'feeds' | 'health' | 'hidden';
  page: number;
  agent?: boolean;
}
export const hiddenArticlePageSize = 50;
export function feedLibraryLocation(url: URL): FeedLibraryLocation {
  const section = pageChoice(
    url.searchParams.get('section'),
    ['feeds', 'health', 'hidden'],
    'feeds',
  );
  return {
    section,
    page: section === 'hidden' ? pageNumber(url.searchParams.get('page')) : 1,
    ...(url.searchParams.get('agent') === '1' ? { agent: true } : {}),
  };
}
export function feedLibraryHref(state: FeedLibraryLocation): string {
  const params = new URLSearchParams();
  if (state.section !== 'feeds') params.set('section', state.section);
  if (state.section === 'hidden' && state.page > 1) params.set('page', String(state.page));
  if (state.agent) params.set('agent', '1');
  return `/feeds${params.size ? `?${params}` : ''}`;
}
export function rulePageLocation(url: URL): {
  id: number | null;
  tab: 'preview' | 'log';
  page?: number;
} {
  const match = /^\/rules(?:\/([^/]+))?$/.exec(url.pathname);
  const legacy = url.pathname === '/' && url.searchParams.get('view') === 'rules';
  if (!match && !legacy) return { id: null, tab: 'preview' };
  const value = match?.[1] ?? (legacy ? url.searchParams.get('rule') : null);
  const id = value === undefined || value === null ? null : pageId(value);
  const tab = pageChoice(url.searchParams.get('tab'), ['preview', 'log'], 'preview');
  if (id === null && tab === 'log') throw new PageInputError('Choose a rule to read its log.');
  const page = pageNumber(url.searchParams.get('page'));
  if (page > 1 && tab !== 'log') throw new PageInputError('Choose an execution log to page.');
  return { id, tab, ...(page > 1 ? { page } : {}) };
}
export const rulePageHref = (id: number | null, tab: 'preview' | 'log' = 'preview', page = 1) =>
  `/rules${id === null ? '' : `/${id}`}${tab === 'log' ? `?tab=log${page > 1 ? `&page=${page}` : ''}` : ''}`;
export interface NewsletterLocation {
  view: NewsletterView;
  senderId: number | null;
  letterId: number | null;
  letterSenderId: number | null;
  page: number;
  sort: 'recent' | 'name' | 'unread';
  agent?: boolean;
}
export function newsletterLocation(url: URL): NewsletterLocation {
  const path = url.pathname.replace(/\.(md|json)$/, '');
  const match = /^\/letters(?:\/([^/]+))?(?:\/([^/]+))?\/?$/.exec(path);
  if (!match) throw new PageInputError('Newsletter page not found.', 404);
  const params = url.searchParams;
  const sender = match[1] ? pageId(match[1]) : null;
  const letterId = match[2] ? pageId(match[2]) : null;
  const legacySender = params.has('sender') ? pageId(params.get('sender')!) : null;
  if (sender !== null && legacySender !== null && sender !== legacySender)
    throw new PageInputError('Sender filters do not match the URL.');
  const scope = pageChoice(
    params.get('scope'),
    ['all', 'sender'],
    sender === null ? 'all' : 'sender',
  );
  if (
    (sender !== null && letterId === null && scope === 'all') ||
    (sender === null && legacySender === null && scope === 'sender')
  )
    throw new PageInputError('Invalid newsletter context.');
  return {
    view: pageChoice(params.get('view'), ['inbox', 'favorites', 'skipped', 'blocked'], 'inbox'),
    senderId: letterId !== null && scope === 'all' ? null : (sender ?? legacySender),
    letterId,
    letterSenderId: letterId === null ? null : sender,
    page: pageNumber(params.get('page')),
    sort: pageChoice(params.get('sort'), ['recent', 'name', 'unread'], 'recent'),
    ...(params.get('agent') === '1' ? { agent: true } : {}),
  };
}
export function newsletterHref(state: NewsletterLocation): string {
  const sender = state.letterId === null ? state.senderId : state.letterSenderId;
  if (state.letterId !== null && sender === null)
    throw new PageInputError('Choose the letter sender.');
  const path = `/letters${sender === null ? '' : `/${sender}`}${state.letterId === null ? '' : `/${state.letterId}`}`;
  const params = new URLSearchParams();
  if (state.view !== 'inbox') params.set('view', state.view);
  if (state.letterId !== null && state.senderId === null) params.set('scope', 'all');
  if (state.page > 1) params.set('page', String(state.page));
  if (state.sort !== 'recent') params.set('sort', state.sort);
  if (state.agent) params.set('agent', '1');
  return `${path}${params.size ? `?${params}` : ''}`;
}
export const newsletterListHref = (
  state: Pick<NewsletterLocation, 'view' | 'senderId' | 'page' | 'sort' | 'agent'>,
) => newsletterHref({ ...state, letterId: null, letterSenderId: null });
export function newsletterSenderRoute(
  current: NewsletterLocation,
  sender: Pick<NewsletterSender, 'id' | 'settings'> | null,
): NewsletterLocation {
  const view = !sender
    ? current.view
    : sender.settings.blocked
      ? 'blocked'
      : sender.settings.skipInbox
        ? 'skipped'
        : current.view === 'favorites' && sender.settings.favorite
          ? 'favorites'
          : 'inbox';
  return {
    ...current,
    senderId: sender?.id ?? null,
    view,
    page: 1,
    letterId: null,
    letterSenderId: null,
  };
}
