import {
  isReaderPagePath,
  parseReaderPage,
  readerPageHref,
  type ReaderPageState,
} from '@brew/core/reader-pages';
import { agentPageHref } from './agentLocation';

export function navigateReader(href: string, replace = false) {
  history[replace ? 'replaceState' : 'pushState'](null, '', agentPageHref(href));
  window.dispatchEvent(new PopStateEvent('popstate'));
}
export function navigateReaderPage(href: string) {
  const previous = document.activeElement;
  navigateReader(href);
  const scope = location.pathname + location.search;
  requestAnimationFrame(() => {
    if (
      scope !== location.pathname + location.search ||
      document.querySelector('dialog:modal') ||
      (document.activeElement !== document.body && document.activeElement !== previous)
    )
      return;
    document
      .querySelector<HTMLElement>('.reader-workspace h1[tabindex]')
      ?.focus({ preventScroll: true });
  });
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
