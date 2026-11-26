import {
  readerPageDocument,
  renderReaderPageMarkdown,
} from '../../../core/src/reader-page-outputs.js';
import type { Hono } from 'hono';
import { textOutput, readerOutputParameters } from '../openapi.js';
import type { ApiServices } from '../ports.js';
import { json } from '../http.js';
import {
  parseReaderPage,
  ReaderPageInputError,
  readerPageHref,
  readerPageSize,
  textTwinHref,
} from '../../../core/src/reader-pages.js';

export function registerReaderOutputRoutes(app: Hono, services: ApiServices) {
  const paths = ['/all', '/today', '/starred', '/search']
    .flatMap((path) => ['md', 'json'].map((format) => `${path}.${format}`))
    .concat(['/f/:output', '/feed/:output']);
  for (const path of paths)
    app.get(
      path,
      textOutput(path, 'Export the selected Reader page', readerOutputParameters),
      async (c) => {
        c.header('Cache-Control', 'private, no-store');
        c.header('X-Robots-Tag', 'noindex, nofollow');
        const url = new URL(c.req.url);
        const format = /\.(md|json)$/.exec(url.pathname)?.[1];
        if (!format) return json(c, { error: 'Reader page not found.' }, 404);
        try {
          const state = parseReaderPage(url);
          if (!state) return json(c, { error: 'Reader page not found.' }, 404);
          if (!(await services.capabilities()).outputs?.twins)
            return json(c, { error: 'Reader twins need setup on this instance.' }, 501);
          let title =
            state.kind === 'today'
              ? 'Today'
              : state.kind === 'starred'
                ? 'Starred'
                : state.kind === 'search'
                  ? `Search: ${state.q}`
                  : 'All articles';
          if (
            state.kind === 'feed' ||
            state.kind === 'folder' ||
            (state.kind === 'search' && state.scope === 'folder')
          ) {
            const item =
              state.kind === 'feed'
                ? (await services.feeds.listFeeds()).find((feed) => feed.id === state.id)
                : (await services.feeds.listFolders()).find(
                    (folder) => folder.id === (state.kind === 'search' ? state.folderId : state.id),
                  );
            if (!item) return json(c, { error: 'Reader source not found.' }, 404);
            if (state.kind !== 'search') title = item.title;
          }
          const offset = (state.page - 1) * readerPageSize;
          const result =
            state.kind === 'search'
              ? await services.search.search(state.q, state.scope, {
                  folderId: state.folderId,
                  limit: readerPageSize,
                  offset,
                  includeTotal: true,
                  unread: state.unread,
                  sort: state.sort,
                })
              : await services.reader.articles({
                  view: state.kind === 'today' || state.kind === 'starred' ? state.kind : 'all',
                  feedId: state.kind === 'feed' ? state.id : undefined,
                  folderId: state.kind === 'folder' ? state.id : undefined,
                  unread: state.unread,
                  sort: state.sort,
                  limit: readerPageSize,
                  offset,
                  includeTotal: true,
                });
          if (result.total === undefined)
            return json(c, { error: 'Reader totals need setup on this instance.' }, 501);
          const value = readerPageDocument(
            state,
            title,
            result.items,
            result.total,
            services.outputBaseUrl ?? url.origin,
          );
          const href = readerPageHref(state);
          c.header(
            'Link',
            `<${href}>; rel="alternate"; type="text/html", <${textTwinHref(href, 'md')}>; rel="alternate"; type="text/markdown", <${textTwinHref(href, 'json')}>; rel="alternate"; type="application/json"`,
          );
          c.header(
            'Content-Type',
            format === 'md' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8',
          );
          return c.body(
            format === 'md'
              ? renderReaderPageMarkdown(value)
              : JSON.stringify(value, null, 2) + '\n',
          );
        } catch (error) {
          return error instanceof ReaderPageInputError
            ? json(c, { error: error.message }, 400)
            : json(c, { error: 'Could not load this Reader page.' }, 500);
        }
      },
    );
}
