const nativeLocation = window.location;
const nativeHistory = window.history;
export const browserBase = new URL('./', nativeLocation.href);
let route = new URL(
  nativeLocation.hash.startsWith('#/') ? nativeLocation.hash.slice(1) : '/',
  nativeLocation.origin,
);
function virtualUrl(value: string | URL) {
  const target = new URL(String(value), route);
  const local = new URL('__local/', browserBase).pathname;
  if (target.origin === browserBase.origin && target.pathname.startsWith(local))
    return new URL(
      '/' + target.pathname.slice(local.length) + target.search + target.hash,
      browserBase.origin,
    );
  return target.origin === browserBase.origin &&
    target.pathname === browserBase.pathname &&
    target.hash.startsWith('#/')
    ? new URL(target.hash.slice(1), browserBase.origin)
    : target;
}
/** Real portable hrefs for the shared UI, with virtual URLs retained in route handlers. */
export function browserHref(href: string) {
  if (href.startsWith('#'))
    return browserBase.pathname + '#' + route.pathname + route.search + href;
  if (!href.startsWith('/') || href.startsWith('//')) return href;
  const target = new URL(href, browserBase.origin);
  if (target.pathname.startsWith(browserBase.pathname)) return href;
  return /\.(?:md|json|xml|atom|txt)$/.test(target.pathname) || target.pathname.startsWith('/api/')
    ? new URL('__local' + target.pathname + target.search + target.hash, browserBase).href
    : browserBase.pathname + '#' + target.pathname + target.search + target.hash;
}
class BrowserUrl extends URL {
  constructor(value: string | URL, base?: string | URL) {
    super(String(value), base === undefined ? undefined : String(base));
    const normalized = virtualUrl(this);
    if (normalized.href !== this.href) this.href = normalized.href;
  }
}
function navigate(
  value: string | URL | null | undefined,
  replace: boolean,
  data: unknown,
  notify = false,
) {
  const next = value == null ? route : virtualUrl(value);
  const hashChanged = next.hash !== route.hash;
  if (next.origin !== browserBase.origin) {
    nativeLocation.assign(next.href);
    return;
  }
  route = next;
  nativeHistory[replace ? 'replaceState' : 'pushState'](
    data,
    '',
    browserBase.pathname + browserBase.search + '#' + next.pathname + next.search + next.hash,
  );
  if (notify) window.dispatchEvent(new PopStateEvent('popstate', { state: data }));
  if (notify && hashChanged) window.dispatchEvent(new HashChangeEvent('hashchange'));
}
export const browserLocation = new Proxy({} as Location, {
  get(_target, key) {
    if (key === 'assign') return (value: string) => navigate(value, false, null, true);
    if (key === 'replace') return (value: string) => navigate(value, true, null, true);
    if (key === 'reload') return () => nativeLocation.reload();
    if (key === 'ancestorOrigins') return nativeLocation.ancestorOrigins;
    const value = Reflect.get(route, key);
    return typeof value === 'function' ? value.bind(route) : value;
  },
  set(_target, key, value) {
    const next = new URL(route);
    Reflect.set(next, key, value);
    navigate(next, false, null, true);
    return true;
  },
});
export const browserHistory = {
  pushState: (data: unknown, _unused: string, value?: string | URL | null) =>
    navigate(value, false, data),
  replaceState: (data: unknown, _unused: string, value?: string | URL | null) =>
    navigate(value, true, data),
  back: () => nativeHistory.back(),
  forward: () => nativeHistory.forward(),
  go: (delta?: number) => nativeHistory.go(delta),
  get state() {
    return nativeHistory.state;
  },
  get length() {
    return nativeHistory.length;
  },
  scrollRestoration: nativeHistory.scrollRestoration,
};
window.addEventListener('hashchange', () => {
  route = new URL(
    nativeLocation.hash.startsWith('#/') ? nativeLocation.hash.slice(1) : '/',
    nativeLocation.origin,
  );
  window.dispatchEvent(new PopStateEvent('popstate', { state: nativeHistory.state }));
});

const streams = new Set<BrowserEvents>();
export function publishBrowserEvent(name: string, value: unknown) {
  for (const stream of streams)
    stream.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(value) }));
}
/** EventSource-compatible local stream; no HTTP server or background library is created. */
export class BrowserEvents extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readonly withCredentials = false;
  readonly url: string;
  readyState = 1;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(url: string | URL) {
    super();
    this.url = String(url);
    if (new URL(this.url, browserBase).pathname !== '/api/events')
      throw new Error('Use the local Brew event stream.');
    streams.add(this);
    queueMicrotask(() => {
      if (this.readyState === 1) {
        const event = new Event('open');
        this.dispatchEvent(event);
        this.onopen?.(event);
      }
    });
  }
  close() {
    this.readyState = 2;
    streams.delete(this);
  }
}
Object.assign(globalThis, {
  __brewBrowserLocation: browserLocation,
  __brewBrowserHistory: browserHistory,
  __brewBrowserEvents: BrowserEvents,
  __brewBrowserURL: BrowserUrl,
});

export function localNavigation(event: MouseEvent) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  const anchor =
    event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
  if (!anchor || anchor.download || anchor.target || anchor.getAttribute('href')?.startsWith('#'))
    return;
  const href = anchor.getAttribute('href')!;
  const target = virtualUrl(href);
  if (
    target.origin !== browserBase.origin ||
    /\.(?:md|json|xml|html)$/.test(target.pathname) ||
    target.pathname.startsWith('/api/') ||
    target.pathname.startsWith('/samples/')
  )
    return;
  event.preventDefault();
  navigate(target, false, null, true);
}
