import type { Hono } from 'hono';
import type { ApiServices } from '../ports.js';
import { json } from '../http.js';
import { brewOutputSnapshot } from '../../../core/src/brew-output-snapshot.js';
import {
  renderBrewAtom,
  renderBrewJson,
  renderBrewJsonFeed,
  renderBrewMarkdown,
} from '../../../core/src/brew-outputs.js';

const id = (value: string): number | null =>
  /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;

export function registerBrewOutputRoutes(app: Hono, services: ApiServices): void {
  app.use('/b/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Robots-Tag', 'noindex, nofollow');
  });
  app.get('/b/:brew/:output', async (c, next) => {
    const match = /^(\d+)\.(md|json)$/.exec(c.req.param('output'));
    if (!match) return next();
    const brew = id(c.req.param('brew'));
    const issueId = id(match[1]!);
    if (!brew || !issueId) return json(c, { error: 'Issue not found' }, 404);
    const issue = await services.brews.snapshot(issueId);
    if (!issue || issue.brewConfigId !== brew) return json(c, { error: 'Issue not found' }, 404);
    if (!(await services.capabilities()).outputs?.twins)
      return json(c, { error: 'Issue twins need setup on this instance.' }, 501);
    const snapshot = brewOutputSnapshot(issue);
    const options = { baseUrl: services.outputBaseUrl ?? new URL(c.req.url).origin };
    const path = `/b/${brew}/${issueId}`;
    c.header(
      'Link',
      `<${path}>; rel="alternate"; type="text/html", <${path}.md>; rel="alternate"; type="text/markdown", <${path}.json>; rel="alternate"; type="application/json"`,
    );
    c.header(
      'Content-Type',
      match[2] === 'md' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8',
    );
    return c.body(
      match[2] === 'md' ? renderBrewMarkdown(snapshot, options) : renderBrewJson(snapshot, options),
    );
  });
  app.get('/b/:output', async (c, next) => {
    const match = /^(\d+)\.(atom|json)$/.exec(c.req.param('output'));
    if (!match) return next();
    const brew = id(match[1]!);
    const config = brew ? await services.brews.composition(brew) : null;
    if (!config) return json(c, { error: 'Brew not found' }, 404);
    if (!(await services.capabilities()).outputs?.feed)
      return json(c, { error: 'Issue feeds need setup on this instance.' }, 501);
    if (!config.delivery.feed)
      return json(c, { error: 'Issue feeds are turned off for this Brew.' }, 404);
    const issues = (await services.brews.history(config.id)).map((issue) =>
      brewOutputSnapshot(issue),
    );
    const options = { baseUrl: services.outputBaseUrl ?? new URL(c.req.url).origin };
    const info = { id: config.id, name: config.name, updatedAt: config.createdAt };
    c.header(
      'Content-Type',
      match[2] === 'atom'
        ? 'application/atom+xml; charset=utf-8'
        : 'application/feed+json; charset=utf-8',
    );
    return c.body(
      match[2] === 'atom'
        ? renderBrewAtom(info, issues, options)
        : renderBrewJsonFeed(info, issues, options),
    );
  });
}
