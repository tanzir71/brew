export interface ReaderPageState {
  kind: 'all' | 'today' | 'starred' | 'feed' | 'folder' | 'search';
  id?: number;
  q: string;
  scope: 'all' | 'folder' | 'starred';
  folderId?: number;
  contextFeedId?: number;
  page: number;
  density: 'title' | 'magazine' | 'cards';
  unread: boolean;
  sort: 'newest' | 'oldest';
  agent?: boolean;
}
export const readerPageSize = 50;
export class ReaderPageInputError extends Error {}
export const isReaderPagePath = (path: string) =>
  /^\/(all|today|starred|search)$/.test(path) || /^\/(f|feed)\/[1-9]\d*$/.test(path);
export const isReaderPageOutputPath = (path: string) =>
  /^\/(all|today|starred|search)\.(md|json)$/.test(path) ||
  /^\/(f|feed)\/[^/]+\.(md|json)$/.test(path);
export const textTwinHref = (path: string, format: 'md' | 'json') => {
  const [pathname, query] = path.split('?');
  return `${pathname}.${format}${query ? `?${query}` : ''}`;
};
function positive(value: string, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(number) || number > max)
    throw new ReaderPageInputError('Invalid Reader identity or page.');
  return number;
}
/** Canonical reader URLs plus existing root-query bookmarks. No browser globals. */
export function parseReaderPage(url: URL): ReaderPageState | null {
  const params = url.searchParams;
  const path = url.pathname.replace(/\.(md|json)$/, '');
  const legacy = path === '/' && (params.get('view') === 'reader' || Boolean(params.get('q')));
  if (!legacy && !isReaderPagePath(path)) return null;
  let kind: ReaderPageState['kind'] = path.slice(1) as ReaderPageState['kind'];
  let id: number | undefined;
  if (legacy) {
    if (params.has('feed') || params.has('folder')) {
      kind = params.has('feed') ? 'feed' : 'folder';
      id = positive(params.get(kind)!);
    } else {
      const scope = params.get('scope');
      kind = scope === 'today' || scope === 'starred' ? scope : 'all';
    }
    if (params.get('q')?.trim()) kind = 'search';
  } else if (path.startsWith('/f/') || path.startsWith('/feed/')) {
    kind = path.startsWith('/f/') ? 'folder' : 'feed';
    id = positive(path.split('/')[2]!);
  }
  const density = params.get('density') ?? 'magazine';
  const sort = params.get('sort') ?? 'newest';
  const scope = kind === 'search' ? (params.get('scope') ?? 'all') : 'all';
  if (
    !['title', 'magazine', 'cards'].includes(density) ||
    !['newest', 'oldest'].includes(sort) ||
    !['all', 'folder', 'starred'].includes(scope) ||
    (params.has('unread') && !['true', 'false'].includes(params.get('unread')!))
  )
    throw new ReaderPageInputError('Invalid Reader filter.');
  const folderId = params.has('folderId')
    ? positive(params.get('folderId')!)
    : legacy && kind === 'search' && params.has('folder')
      ? positive(params.get('folder')!)
      : undefined;
  if (kind === 'search' && scope === 'folder' && folderId === undefined)
    throw new ReaderPageInputError('Choose a folder for this search.');
  return {
    kind,
    id: kind === 'search' ? undefined : id,
    q: params.get('q')?.trim() ?? '',
    scope: scope as ReaderPageState['scope'],
    folderId,
    contextFeedId: params.has('feedId')
      ? positive(params.get('feedId')!)
      : legacy && kind === 'search' && params.has('feed')
        ? positive(params.get('feed')!)
        : undefined,
    page: params.has('page') ? positive(params.get('page')!, 1_000_000) : 1,
    density: density as ReaderPageState['density'],
    unread: params.get('unread') === 'true',
    sort: sort as ReaderPageState['sort'],
    agent: params.get('agent') === '1',
  };
}
export function readerPageHref(state: ReaderPageState): string {
  const path =
    state.kind === 'folder'
      ? `/f/${state.id}`
      : state.kind === 'feed'
        ? `/feed/${state.id}`
        : `/${state.kind}`;
  const params = new URLSearchParams();
  if (state.kind === 'search') {
    params.set('q', state.q);
    if (state.scope !== 'all') params.set('scope', state.scope);
    if (state.folderId !== undefined) params.set('folderId', String(state.folderId));
    if (state.contextFeedId !== undefined) params.set('feedId', String(state.contextFeedId));
  }
  if (state.page !== 1) params.set('page', String(state.page));
  if (state.density !== 'magazine') params.set('density', state.density);
  if (state.unread) params.set('unread', 'true');
  if (state.sort !== 'newest') params.set('sort', state.sort);
  if (state.agent) params.set('agent', '1');
  return `${path}${params.size ? `?${params}` : ''}`;
}
