import type { Hono } from 'hono';
import { textOutput } from '../openapi.js';
import type { ApiServices } from '../ports.js';
import { json } from '../http.js';
import { renderArticleJson, renderArticleMarkdown } from '../../../core/src/article-outputs.js';

export function registerArticleOutputRoutes(app: Hono, services: ApiServices): void {
  app.use('/a/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Robots-Tag', 'noindex, nofollow');
  });
  app.get(
    '/a/:output',
    textOutput('/a/:output', 'Export one article as Markdown or JSON'),
    async (c) => {
      const match = /^([1-9]\d*)\.(md|json)$/.exec(c.req.param('output'));
      const id = match ? Number(match[1]) : NaN;
      if (!Number.isSafeInteger(id)) return json(c, { error: 'Article not found' }, 404);
      const article = await services.articles.get(id);
      if (!article) return json(c, { error: 'Article not found' }, 404);
      if (!(await services.capabilities()).outputs?.twins)
        return json(c, { error: 'Article twins need setup on this instance.' }, 501);
      const base = services.outputBaseUrl ?? new URL(c.req.url).origin;
      c.header(
        'Link',
        `</a/${id}>; rel="alternate"; type="text/html", </a/${id}.md>; rel="alternate"; type="text/markdown", </a/${id}.json>; rel="alternate"; type="application/json"`,
      );
      c.header(
        'Content-Type',
        match![2] === 'md' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8',
      );
      return c.body(
        match![2] === 'md'
          ? renderArticleMarkdown(article, base)
          : renderArticleJson(article, base),
      );
    },
  );
}
