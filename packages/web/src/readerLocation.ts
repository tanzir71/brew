import {
  isReaderPagePath,
  parseReaderPage,
  readerPageHref,
  type ReaderPageState,
} from '@brew/core/reader-pages';

export function navigateReader(href: string, replace = false) {
  history[replace ? 'replaceState' : 'pushState'](null, '', href);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
export function readerState(): ReaderPageState {
  return (
    parseReaderPage(new URL(location.href)) ?? {
      kind: 'all',
      q: '',
      scope: 'all',
      page: 1,
      density: 'magazine',
      unread: false,
      sort: 'newest',
    }
  );
}
export function searchHref(q: string) {
  const state = readerState();
  return readerPageHref({
    ...state,
    kind: 'search',
    id: undefined,
    q,
    scope: 'all',
    page: 1,
    folderId: state.kind === 'folder' ? state.id : state.folderId,
    contextFeedId: state.kind === 'feed' ? state.id : state.contextFeedId,
  });
}
export const isReaderLocation = () => isReaderPagePath(location.pathname);
export function closeSearchHref() {
  const state = readerState();
  const kind =
    state.kind !== 'search'
      ? state.kind
      : state.contextFeedId
        ? 'feed'
        : state.folderId
          ? 'folder'
          : 'all';
  const id = state.kind !== 'search' ? state.id : (state.contextFeedId ?? state.folderId);
  return readerPageHref({ ...state, kind, id, q: '', scope: 'all', page: 1 });
}
