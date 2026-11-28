import raw from './fixtures.json';
import outputs from './outputs.json';
import { matchesRule } from '../../packages/core/src/rule-matching';
import type { RuleCondition, RuleScope } from '../../packages/core/src/types/rules';
import type {
  ArticleDetail,
  ArticleSummary,
  ReaderNavigation,
} from '../../packages/core/src/types/api';
import type { BrewConfig, BrewConfigDraft, BrewIssue } from '../../packages/core/src/types/brew';
import type { BrewCandidate, BrewPreviewStoragePort } from '../../packages/core/src/ports';
import type { BrewReadState } from '../../packages/core/src/types/legacy-brew';
import type { RuleRecord } from '../../packages/core/src/types/rules';
import type {
  NewsletterLetter,
  NewsletterLetterPage,
  NewsletterOverview,
} from '../../packages/core/src/types/newsletters';
import { senderInNewsletterView } from '../../packages/core/src/types/newsletters';

// Everything in this adapter is tab-local. No API request or preference reaches a server.
const fixtures = JSON.parse(JSON.stringify(raw).replaceAll('/figma/', './figma/')) as Record<
  string,
  unknown
>;
const payload = <T>(key: string) => fixtures[key] as T;
const articles = payload<{ items: ArticleSummary[] }>('/api/articles?limit=50').items;
const rules = payload<RuleRecord[]>('/api/rules');
const configs = payload<BrewConfig[]>('/api/brew-configs');
const letters = Object.entries(fixtures)
  .filter(([key]) => /^\/api\/newsletters\/letters\/\d+$/.test(key))
  .map(([, value]) => value as NewsletterLetter);
for (const letter of letters) letter.originalAvailable = false;
payload<{ actions: { undo: boolean }; agentAccess: boolean; mcp: null }>(
  '/api/capabilities',
).actions.undo = false;
payload<{ agentAccess: boolean; mcp: null }>('/api/capabilities').agentAccess = false;
payload<{ mcp: null }>('/api/capabilities').mcp = null;
const previewStorage: BrewPreviewStoragePort = {
  nextIssueNumber: async () => {
    const first = firstHistory[0]!;
    return ('issueNumber' in first ? first.issueNumber : 1) + 1;
  },
  savedSourceSearch: async () => undefined,
  compositionItems: async (query) => {
    const selected: BrewCandidate[] = [];
    for (const item of articles) {
      const letter = letters.find((letter) => letter.id === item.id);
      if (Boolean(letter) !== Boolean(query.newsletters)) continue;
      if (
        query.newsletters?.senderIds?.length &&
        !query.newsletters.senderIds.includes(item.feedId)
      )
        continue;
      if ((query.onlyUnread && item.readAt) || (query.starred && !item.starredAt)) continue;
      if (
        (query.folderId && item.folderId !== query.folderId) ||
        (query.feedId && item.feedId !== query.feedId)
      )
        continue;
      if (query.publishedSince && Date.parse(item.publishedAt) < query.publishedSince) continue;
      const detail = payload<ArticleDetail>(`/api/articles/${item.id}`);
      if (query.tagId && !detail.tags.some((tag) => tag.id === query.tagId)) continue;
      if (
        query.searchQuery &&
        !(item.title + detail.contentHtml).toLowerCase().includes(query.searchQuery.toLowerCase())
      )
        continue;
      selected.push({
        ...item,
        feed: item.feedTitle,
        folder: item.folderTitle ?? '',
        author: item.author ?? '',
        body: detail.fullTextHtml ?? detail.contentHtml,
        content: detail.fullTextHtml ?? detail.contentHtml ?? '',
        publishedAt: Date.parse(item.publishedAt),
        readAt: item.readAt ? Date.parse(item.readAt) : null,
        ...(letter ? { newsletter: { cleaning: letter.cleaning } } : {}),
      });
    }
    return selected;
  },
};
const realLocation = document.location;
const realHistory = document.defaultView!.history;
const firstHistory = payload<BrewIssue[]>(`/api/brew-configs/${configs[0]!.id}/history`);
const virtual = new URL(
  realLocation.hash.slice(1) || `/b/${configs[0]!.id}/${firstHistory[0]!.id}`,
  realLocation.origin,
);
function navigate(value: string | URL | null | undefined, replace = false, notify = false) {
  if (value === undefined || value === null) return;
  const next = new URL(value, virtual);
  virtual.href = next.href;
  realHistory[replace ? 'replaceState' : 'pushState'](null, '', '#' + next.pathname + next.search);
  if (notify) window.dispatchEvent(new PopStateEvent('popstate'));
}
const memory = new Map<string, string>([
  ['brew:theme', 'light'],
  ['brew:direct-images', 'true'],
  [
    'brew:saved-searches',
    JSON.stringify([{ id: 'figma', name: 'Figma mentions', query: 'Figma' }]),
  ],
]);
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, String(value));
  },
  removeItem: (key: string) => {
    memory.delete(key);
  },
  clear: () => memory.clear(),
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size;
  },
};
class LocalEvents extends EventTarget {
  close() {}
}
Object.assign(globalThis, {
  __brewDemoLocation: Object.assign(virtual, {
    assign: (value: string) => navigate(value, false, true),
    replace: (value: string) => navigate(value, true, true),
    reload: () => realLocation.reload(),
  }),
  __brewDemoHistory: {
    pushState: (_state: unknown, _title: string, value?: string) => navigate(value),
    replaceState: (_state: unknown, _title: string, value?: string) => navigate(value, true),
    back: () => realHistory.back(),
  },
  __brewDemoStorage: storage,
  __brewDemoEvents: LocalEvents,
});
window.addEventListener('hashchange', () => {
  virtual.href = new URL(realLocation.hash.slice(1) || '/', realLocation.origin).href;
  window.dispatchEvent(new PopStateEvent('popstate'));
});
document.addEventListener('click', (event) => {
  if (event.defaultPrevented) return;
  const anchor = (event.target as Element).closest('a');
  const href = anchor?.getAttribute('href');
  if (!href?.startsWith('/') || href.startsWith('//') || event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  if (/\.(?:md|json|atom)$/.test(href)) {
    const output = (outputs as Record<string, { body: string; type: string }>)[href.split('?')[0]!];
    if (!output) {
      window.alert('This export needs your own Brew instance.');
      return;
    }
    const body = output.body
      .replaceAll('http://localhost/figma/', new URL('./figma/', realLocation.href).href)
      .replaceAll('http://localhost/a/', new URL('./#/a/', realLocation.href).href);
    const blob = new Blob([body], { type: output.type });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = href.split('/').at(-1)!.split('?')[0]!;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    return;
  }
  navigate(href, false, true);
});
document.querySelector('#demo-theme')!.addEventListener('click', () => {
  storage.setItem('brew:theme', memory.get('brew:theme') === 'dark' ? 'light' : 'dark');
  window.dispatchEvent(new Event('brew:preferences-changed'));
});
document.querySelector('#demo-navigation')!.addEventListener('change', (event) => {
  const select = event.target as HTMLSelectElement;
  if (select.value) navigate(select.value, false, true);
});
document.addEventListener('submit', (event) => {
  if (event.defaultPrevented) return;
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.getAttribute('action')?.startsWith('/')) return;
  event.preventDefault();
  const next = new URL(form.getAttribute('action')!, realLocation.origin);
  for (const [key, value] of new FormData(form))
    if (typeof value === 'string') next.searchParams.set(key, value);
  navigate(next, false, true);
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const target = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input : input.url,
    realLocation.href,
  );
  const pathname = target.pathname;
  if (!pathname.startsWith('/api/')) return nativeFetch(input, init);
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  if (/^\/api\/brew-configs\/\d+\/preview$/.test(pathname)) {
    const { CompositionPreview } = await import('../../packages/core/src/composition-preview');
    try {
      const preview = new CompositionPreview(
        previewStorage,
        { now: () => new Date('2026-11-25T01:00:00Z'), monotonic: () => performance.now() },
        {
          test: async () => ({
            matched: false,
            timedOut: false,
            error: 'Regex preview needs your own Brew instance.',
          }),
        },
      );
      const result = await preview.build(
        body.draft as BrewConfigDraft,
        Number(pathname.split('/')[3]),
      );
      result.outputs.email = result.outputs.email.replaceAll('src="/figma/', 'src="./figma/');
      return json(result);
    } catch (error) {
      return json({ error: (error as Error).message }, 400);
    }
  }
  if (pathname === '/api/actions') return json([]);
  if (pathname === '/api/rules/duplicate-filter') return json({ enabled: false });
  if (pathname === '/api/rules/preview') {
    const conditions = (body.conditions ?? []) as RuleCondition[];
    if (conditions.some((value) => value.operator === 'matches_regex'))
      return json({ error: 'Regex preview needs your own Brew instance.' }, 501);
    const matched = [];
    for (const item of articles) {
      const context = {
        ...item,
        content: item.summaryHtml ?? '',
        feed: item.feedTitle,
        folder: item.folderTitle ?? '',
        author: item.author ?? '',
      };
      if (
        await matchesRule(
          {
            test: async () => {
              throw new Error('Regex preview needs your own Brew.');
            },
          },
          context,
          (body.scope ?? {}) as RuleScope,
          body.matchType === 'any' ? 'any' : 'all',
          conditions,
        )
      )
        matched.push(item);
    }
    return json({ items: matched.slice(0, 50), total: matched.length });
  }
  if (pathname === '/api/articles' || pathname === '/api/search') {
    let items = articles;
    const params = target.searchParams;
    if (params.get('view') === 'starred') items = items.filter((item) => item.starredAt);
    if (params.get('unread') === 'true') items = items.filter((item) => !item.readAt);
    if (params.has('feedId'))
      items = items.filter((item) => item.feedId === Number(params.get('feedId')));
    if (params.has('folderId'))
      items = items.filter((item) => item.folderId === Number(params.get('folderId')));
    if (params.get('q'))
      items = items.filter((item) =>
        (item.title + item.feedTitle + item.summaryHtml)
          .toLowerCase()
          .includes(params.get('q')!.toLowerCase()),
      );
    const offset = Number(params.get('offset') ?? 0);
    return json({
      items: items.slice(offset, offset + 50),
      total: items.length,
      nextCursor: null,
      nextOffset: null,
      durationMs: 1,
    });
  }
  if (/^\/api\/articles\/\d+$/.test(pathname)) {
    const detail = payload<ArticleDetail>(pathname);
    const item = articles.find((value) => value.id === detail?.id);
    if (!detail || !item) return json({ error: 'Sample article not found.' }, 404);
    if (method === 'PATCH') {
      if (body.read !== undefined) item.readAt = body.read ? '2026-11-25T08:00:00Z' : null;
      if (body.starred !== undefined) item.starredAt = body.starred ? '2026-11-25T08:00:00Z' : null;
      Object.assign(detail, item);
      for (const [key, value] of Object.entries(fixtures))
        if (/^\/api\/brews\/\d+\/state$/.test(key)) {
          const state = (value as BrewReadState).articles.find((value) => value.id === item.id);
          if (state) Object.assign(state, { readAt: item.readAt, starredAt: item.starredAt });
        }
    }
    return json({ ...detail, ...item });
  }
  if (pathname === '/api/newsletters/letters') {
    const page = payload<NewsletterLetterPage>('/api/newsletters/letters?view=inbox&page=1');
    const overview = payload<NewsletterOverview>('/api/newsletters/overview');
    const view = target.searchParams.get('view') ?? 'inbox';
    const sender = Number(target.searchParams.get('sender'));
    const items = page.items.filter((item) => {
      const value = overview.senders.find((value) => value.id === item.feedId);
      return (
        value &&
        senderInNewsletterView(value.settings, view as 'inbox') &&
        (!sender || item.feedId === sender)
      );
    });
    return json({ ...page, items, total: items.length });
  }
  if (pathname === '/api/reader/navigation') {
    const nav = structuredClone(payload<ReaderNavigation>(pathname));
    nav.counts = {
      all: articles.length,
      today: articles.filter((item) => !item.readAt).length,
      starred: articles.filter((item) => item.starredAt).length,
    };
    return json(nav);
  }
  if (/^\/api\/rules\/\d+$/.test(pathname) && method === 'PUT') {
    const rule = rules.find((value) => value.id === Number(pathname.split('/').at(-1)));
    if (!rule) return json({ error: 'Sample rule not found.' }, 404);
    Object.assign(rule, body);
    return json(rule);
  }
  if (/\/api\/brew-configs\/\d+\/composition$/.test(pathname) && method === 'PUT') {
    Object.assign(fixtures[pathname] as object, body);
    return json(fixtures[pathname]);
  }
  if (pathname.endsWith('/scroll')) return json({ ok: true });
  if (method === 'GET' && fixtures[pathname] !== undefined) return json(fixtures[pathname]);
  if (method === 'GET' && fixtures[pathname + target.search] !== undefined)
    return json(fixtures[pathname + target.search]);
  if (method === 'GET' && /\/rules\/\d+\/log$/.test(pathname))
    return json({ items: [], total: 0, page: 1, pageSize: 50 });
  if (method === 'GET' && pathname.endsWith('/tags')) return json([]);
  return json(
    { error: 'This server action is unavailable in the public demo. Run your own Brew to use it.' },
    501,
  );
};
