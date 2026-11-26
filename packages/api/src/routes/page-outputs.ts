import type { Hono } from 'hono';
import type { ApiServices } from '../ports.js';
import type { RuleCondition, RuleRecord } from '../../../core/src/types/rules.js';
import type { Capabilities } from '../../../core/src/types/capabilities.js';
import { senderInNewsletterView } from '../../../core/src/types/newsletters.js';
import { renderArticleJson, renderArticleMarkdown } from '../../../core/src/article-outputs.js';
import {
  PageInputError,
  pageChoice,
  pageId,
  readerWelcomeCopy,
  newsletterHref,
  newsletterListHref,
  newsletterLocation,
  newsletterSenderRoute,
  feedLibraryLocation,
  feedLibraryHref,
  rulePageLocation,
  rulePageHref,
} from '../../../core/src/app-pages.js';
import {
  pageDocument,
  renderPageMarkdown,
  type PageSection,
} from '../../../core/src/page-document.js';
import { textTwinHref } from '../../../core/src/reader-pages.js';
import { json } from '../http.js';

const conditions = (items: RuleCondition[]) =>
  items.map((item) => ({ field: item.field, operator: item.operator, value: item.value }));
const ruleDetails = (rule: RuleRecord) => ({
  enabled: rule.enabled,
  position: rule.position,
  matchType: rule.matchType,
  scope: { feedIds: rule.scope.feedIds, folderIds: rule.scope.folderIds },
  conditions: conditions(rule.conditions),
  actions: rule.actions.map((action) =>
    action.type === 'webhook'
      ? { type: action.type, configured: Boolean(action.url) }
      : action.type === 'add_tag' || action.type === 'remove_tag'
        ? { type: action.type, tag: action.tag }
        : action.type === 'highlight'
          ? { type: action.type, color: action.color }
          : { type: action.type },
  ),
  stopProcessing: rule.stopProcessing,
  hits24h: rule.hits24h ?? 0,
  hits30d: rule.hits30d ?? 0,
});
const missing = (message: string): never => {
  throw new PageInputError(message, 404);
};

async function document(services: ApiServices, url: URL, caps: Capabilities) {
  const path = url.pathname.replace(/\.(md|json)$/, '');
  const params = url.searchParams;
  const base = services.outputBaseUrl ?? url.origin;
  const make = (
    kind: string,
    title: string,
    html: string,
    state: unknown,
    sections: PageSection[],
    representation?: string,
  ) => pageDocument(kind, title, html, state, sections, base, representation);
  if (path === '/reader')
    return make(
      'reader-welcome',
      readerWelcomeCopy.title,
      '/?view=reader&scope=brew',
      {},
      [
        {
          title: readerWelcomeCopy.heading,
          text: readerWelcomeCopy.description,
          items: [
            { title: 'Today', url: '/today' },
            { title: 'All articles', url: '/all' },
          ],
        },
      ],
      'page content',
    );
  if (path === '/index') {
    const configs = await services.brews.listConfigs();
    return make('library', 'Your Brews', '/', {}, [
      {
        title: 'Brews',
        data: { total: configs.length },
        items: configs.map((config) => ({
          id: config.id,
          title: config.name,
          url: `/b/${config.id}`,
          details: { enabled: config.enabled },
        })),
      },
    ]);
  }
  const brew = /^\/b\/([^/]+)\/(compose|read)$/.exec(path);
  if (brew) {
    const id = pageId(brew[1]!);
    const config = (await services.brews.composition(id)) ?? missing('Brew not found.');
    const section = params.get('section');
    if (section !== null && !config.sections.some((item) => item.id === section))
      missing('Section not found.');
    const sheet = pageChoice(
      params.get('sheet'),
      ['none', 'add-source', 'schedule', 'add-section', 'brew', 'section-options'],
      'none',
    );
    const state = { brewId: id, section, sheet: sheet === 'none' ? null : sheet };
    const html = `/b/${id}${brew[2] === 'compose' ? '/compose' : ''}${url.search}`;
    const details = {
      enabled: config.enabled,
      timezone: config.timezone,
      schedule: {
        kind: config.schedule.kind,
        time: config.schedule.time,
        days: config.schedule.days,
        dayOfMonth: config.schedule.dayOfMonth,
        skipIfFewerThan: config.schedule.skipIfFewerThan,
      },
      delivery: {
        web: config.delivery.web,
        feed: config.delivery.feed,
        email: Boolean(config.delivery.email),
        webhook: Boolean(config.delivery.webhook),
        publicCopy: config.delivery.publicCopy,
      },
    };
    return make(
      brew[2]!,
      `${brew[2] === 'compose' ? 'Compose' : 'Read'} · ${config.name}`,
      html,
      state,
      [
        {
          title: 'Saved configuration',
          text: 'Unsaved edits and preview results are not part of this saved configuration.',
          data: details,
        },
        {
          title: 'Sections',
          data: { total: config.sections.length },
          items: config.sections.map((item) => ({
            id: item.id,
            title: item.title || item.kind,
            details: {
              kind: item.kind,
              sources: item.sources.map((source) => ({
                kind: source.kind,
                id: source.id,
                senderIds: source.senderIds,
                tagIds: source.tagIds,
              })),
              maxItems: item.maxItems,
              layout: item.layout,
              depth: item.depth,
              images: item.images,
              onlyUnread: item.onlyUnread,
              sort: item.sort,
              filter: item.filter
                ? { match: item.filter.match, conditions: conditions(item.filter.conditions) }
                : undefined,
              days: item.days,
              note: item.note,
            },
          })),
        },
      ],
    );
  }
  if (path === '/rules' || path.startsWith('/rules/')) {
    const route = rulePageLocation(new URL(path + url.search, base));
    const { id, tab } = route;
    const rules = await services.rules.list();
    const selected =
      id === null ? null : (rules.find((rule) => rule.id === id) ?? missing('Rule not found.'));
    const sections: PageSection[] = [
      {
        title: 'Rules',
        data: {
          total: selected ? 1 : rules.length,
          libraryTotal: rules.length,
          duplicateFilter: await services.data.duplicateFilterEnabled(),
        },
        items: (selected ? [selected] : rules).map((rule) => ({
          id: rule.id,
          title: rule.name,
          url: `/rules/${rule.id}`,
          details: ruleDetails(rule),
        })),
      },
    ];
    if (selected && tab === 'log') {
      const {
        items: logs,
        total,
        page,
        pageSize,
      } = (await services.rules.logPage(selected.id, route.page ?? 1)) ??
      missing('Rule not found.');
      const from = logs.length ? (page - 1) * pageSize + 1 : 0;
      const to = logs.length ? from + logs.length - 1 : 0;
      const link = (page: number) => {
        const target = new URL(rulePageHref(selected.id, 'log', page), base);
        if (params.get('agent') === '1') target.searchParams.set('agent', '1');
        return target.href;
      };
      sections.push({
        title: 'Recent executions',
        text: `Showing ${from}\u2013${to} of ${total} executions`,
        data: {
          total,
          shown: logs.length,
          page,
          pageSize,
          previous: page > 1 ? link(page - 1) : null,
          next: page * pageSize < total ? link(page + 1) : null,
        },
        items: logs.map((log) => ({
          id: log.id,
          title: log.articleTitle,
          url: `/a/${log.articleId}`,
          details: {
            executedAt: log.executedAt,
            actions: log.actions.map((action) => ({ type: action.type, ok: action.ok })),
          },
        })),
      });
    } else if (selected) {
      const { items: matches, total } = await services.rules.previewSummary(selected);
      sections.push({
        title: 'Saved rule preview',
        text: `Showing ${matches.length ? 1 : 0}\u2013${matches.length} of ${total} matching articles, without running actions.`,
        data: { total, shown: matches.length, limit: 50 },
        items: matches.map((item) => ({
          id: item.id,
          title: item.title,
          url: `/a/${item.id}`,
          details: { feedTitle: item.feedTitle, publishedAt: item.publishedAt },
        })),
      });
    }
    return make(
      'rules',
      selected ? `Rules · ${selected.name}` : 'Rules',
      `${path}${url.search}`,
      { ruleId: id, tab, ...(route.page ? { page: route.page } : {}) },
      sections,
    );
  }
  if (path === '/feeds') {
    const route = feedLibraryLocation(url);
    const { section } = route;
    if (section === 'hidden') {
      const { items, total, page, pageSize } = await services.data.hiddenArticlePage(route.page);
      const from = items.length ? (page - 1) * pageSize + 1 : 0;
      const to = items.length ? from + items.length - 1 : 0;
      const link = (page: number) => new URL(feedLibraryHref({ ...route, page }), base).href;
      return make('hidden-articles', 'Hidden articles', feedLibraryHref(route), { section, page }, [
        {
          title: 'Hidden articles',
          text: `Showing ${from ? `${from}–${to}` : '0'} of ${total} hidden articles`,
          data: {
            total,
            page,
            pageSize,
            showing: { from, to },
            previous: page > 1 ? link(page - 1) : null,
            next: page * pageSize < total ? link(page + 1) : null,
          },
          items: items.map((item) => ({
            id: item.id,
            title: item.title,
            url: `/a/${item.id}`,
            details: {
              kind: item.kind,
              feedTitle: item.feedTitle,
              publishedAt: item.publishedAt,
              readAt: item.readAt,
              starredAt: item.starredAt,
              highlightColor: item.highlightColor,
            },
          })),
        },
        {
          title: 'Pages',
          items: [
            ...(page > 1 ? [{ title: 'Previous hidden articles', url: link(page - 1) }] : []),
            ...(page * pageSize < total
              ? [{ title: 'Next hidden articles', url: link(page + 1) }]
              : []),
          ],
        },
      ]);
    }
    const [feeds, folders] = await Promise.all([
      services.feeds.listFeeds(),
      services.feeds.listFolders(),
    ]);
    return make(
      'feeds',
      section === 'health' ? 'Feed health' : 'Feeds',
      `/feeds${url.search}`,
      { section },
      [
        {
          title: 'Feeds',
          data: { total: feeds.length },
          items: feeds.map((feed) => ({
            id: feed.id,
            title: feed.title,
            url: `/feed/${feed.id}`,
            details: {
              folderId: feed.folderId,
              retentionDays: feed.retentionDays,
              lastFetchedAt: feed.lastFetchedAt,
              lastStatus: feed.lastStatus,
              consecutiveFailures: feed.consecutiveFailures,
              failingSince: feed.failingSince,
              healthWarning: feed.healthWarning,
            },
          })),
        },
        {
          title: 'Folders',
          data: { total: folders.length },
          items: folders.map((folder) => ({
            id: folder.id,
            title: folder.title,
            url: `/f/${folder.id}`,
            details: { position: folder.position },
          })),
        },
      ],
    );
  }
  if (path === '/settings/runs') {
    const topic = pageChoice(
      params.get('setup'),
      ['none', 'newsletters', 'delivery', 'apps', 'agents', 'briefs', 'data', 'fetch', 'outputs'],
      'none',
    );
    return make(
      'settings',
      'Where Brew runs',
      `/settings/runs${topic === 'none' ? '' : `#setup-${topic}`}`,
      { section: 'runs', setup: topic === 'none' ? null : topic },
      [
        {
          title: 'Current capabilities',
          data: {
            mode: caps.mode,
            fetch: caps.fetch,
            backgroundFetch: {
              kind: caps.backgroundFetch.kind,
              everyMinutes: caps.backgroundFetch.everyMinutes,
            },
            inboundMail: caps.inboundMail,
            emailDelivery: caps.emailDelivery,
            readerApi: caps.readerApi,
            mcp: caps.mcp,
            webmcp: caps.webmcp,
            ai: { available: caps.ai.available, configured: caps.ai.configured },
            readState: caps.readState,
            publicCopy: caps.publicCopy,
            outputs: caps.outputs
              ? {
                  twins: caps.outputs.twins,
                  feed: caps.outputs.feed,
                  webhook: caps.outputs.webhook,
                }
              : undefined,
            actions: caps.actions ? { undo: caps.actions.undo } : undefined,
            limits: caps.limits ? { maxFetchesPerRun: caps.limits.maxFetchesPerRun } : undefined,
          },
        },
      ],
      'current instance state',
    );
  }
  if (path === '/letters' || /^\/letters\/[^/]+$/.test(path)) {
    if (!services.newsletters)
      throw new PageInputError('Newsletters need setup on this instance.', 501);
    const route = newsletterLocation(url);
    const { view, sort, page } = route;
    const senderId = route.senderId ?? undefined;
    const overview = await services.newsletters.overview();
    if (senderId !== undefined && !overview.senders.some((sender) => sender.id === senderId))
      missing('Sender not found.');
    const letters = await services.newsletters.letters({ view, senderId, page });
    const senders = [...overview.senders].sort((a, b) => {
      const weight = (sender: typeof a) =>
        sender.settings.blocked ? 2 : sender.settings.skipInbox ? 1 : 0;
      return (
        weight(a) - weight(b) ||
        (sort === 'name'
          ? a.title.localeCompare(b.title)
          : sort === 'unread'
            ? b.unreadCount - a.unreadCount || a.title.localeCompare(b.title)
            : (b.latestAt ? Date.parse(b.latestAt) : 0) -
                (a.latestAt ? Date.parse(a.latestAt) : 0) || a.title.localeCompare(b.title))
      );
    });
    return make(
      'newsletters',
      'Newsletters',
      newsletterListHref(route),
      { view, senderId: senderId ?? null, page, sort },
      [
        {
          title: 'Senders',
          data: {
            total: senders.length,
            unreadCount: senders
              .filter((sender) => senderInNewsletterView(sender.settings, view))
              .reduce((sum, sender) => sum + sender.unreadCount, 0),
          },
          items: senders.map((sender) => ({
            id: sender.id,
            title: sender.title,
            url: newsletterHref(newsletterSenderRoute(route, sender)),
            details: {
              favorite: sender.settings.favorite,
              skipped: sender.settings.skipInbox,
              blocked: sender.settings.blocked,
              onlyInBrew: sender.settings.onlyInBrew,
              brewId: sender.settings.brewId,
              retentionDays: sender.settings.retentionDays,
              unreadCount: sender.unreadCount,
              letterCount: sender.letterCount,
              latestAt: sender.latestAt,
            },
          })),
        },
        {
          title: 'Letters',
          data: {
            total: letters.total,
            page: letters.page,
            pageSize: letters.pageSize,
            from: letters.items.length ? (page - 1) * letters.pageSize + 1 : 0,
            to: letters.items.length ? (page - 1) * letters.pageSize + letters.items.length : 0,
          },
          items: letters.items.map((letter) => ({
            id: letter.id,
            title: letter.title,
            url: newsletterHref({ ...route, letterId: letter.id, letterSenderId: letter.feedId }),
            details: {
              feedId: letter.feedId,
              feedTitle: letter.feedTitle,
              publishedAt: letter.publishedAt,
              readAt: letter.readAt,
              starredAt: letter.starredAt,
            },
          })),
        },
      ],
    );
  }
  return missing('Page not found.');
}
export function registerPageOutputRoutes(app: Hono, services: ApiServices) {
  const roots = [
    '/index',
    '/reader',
    '/feeds',
    '/letters',
    '/rules',
    '/settings/runs',
    '/b/:id/compose',
    '/b/:id/read',
  ];
  const paths = roots
    .flatMap((root) => ['md', 'json'].map((format) => `${root}.${format}`))
    .concat(['/rules/:output', '/letters/:output', '/letters/:sender/:output']);
  for (const path of paths)
    app.get(path, async (c) => {
      const format = /\.(md|json)$/.exec(new URL(c.req.url).pathname)?.[1];
      if (!format) return json(c, { error: 'Page not found.' }, 404);
      c.header('Cache-Control', 'private, no-store');
      c.header('X-Robots-Tag', 'noindex, nofollow');
      try {
        const caps = await services.capabilities();
        if (!caps.outputs?.twins)
          return json(c, { error: 'Text formats need setup on this instance.' }, 501);
        const url = new URL(c.req.url);
        if (/^\/letters\/[^/]+\/[^/]+\.(md|json)$/.test(url.pathname)) {
          if (!services.newsletters)
            throw new PageInputError('Newsletters need setup on this instance.', 501);
          const route = newsletterLocation(url);
          const letter =
            (await services.newsletters.letter(route.letterId!)) ??
            missing('Letter not found for this sender.');
          if (letter.feedId !== route.letterSenderId)
            throw new PageInputError('Letter not found for this sender.', 404);
          c.header(
            'Link',
            `<${new URL(newsletterHref(route), services.outputBaseUrl ?? url.origin).href}>; rel="alternate"; type="text/html", </a/${letter.id}.md>; rel="alternate"; type="text/markdown", </a/${letter.id}.json>; rel="alternate"; type="application/json"`,
          );
          c.header(
            'Content-Type',
            format === 'md' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8',
          );
          return c.body(
            format === 'md'
              ? renderArticleMarkdown(letter, services.outputBaseUrl ?? url.origin)
              : renderArticleJson(letter, services.outputBaseUrl ?? url.origin),
          );
        }
        const value = await document(services, url, caps);
        const path = url.pathname.replace(/\.(md|json)$/, '') + url.search;
        c.header(
          'Link',
          `<${value.url}>; rel="alternate"; type="text/html", <${textTwinHref(path, 'md')}>; rel="alternate"; type="text/markdown", <${textTwinHref(path, 'json')}>; rel="alternate"; type="application/json"`,
        );
        c.header(
          'Content-Type',
          format === 'md' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8',
        );
        return c.body(
          format === 'md' ? renderPageMarkdown(value) : JSON.stringify(value, null, 2) + '\n',
        );
      } catch (error) {
        return error instanceof PageInputError
          ? json(c, { error: error.message }, error.status)
          : json(c, { error: 'Could not load this page.' }, 500);
      }
    });
}
