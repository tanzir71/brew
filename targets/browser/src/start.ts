import type { BrowserApi } from './api.js';
import { sampleGroups, sampleFeedUrl } from '../../../packages/core/src/sample-library.js';
import { defaultDelivery, newBrewSection } from '../../../packages/core/src/composition-model.js';

export interface BrowserStart {
  ready: boolean;
  configId?: number;
  issueId?: number;
}
const key = 'browser_first_run';
export async function browserStartStatus(api: BrowserApi): Promise<BrowserStart> {
  const row = await api.storage.first<{ value: string }>('SELECT value FROM settings WHERE key=?', [
    key,
  ]);
  if (!row) return { ready: false };
  const saved = JSON.parse(row.value) as BrowserStart;
  if (!saved.ready) return saved;
  const current = await api.storage.first<{ configId: number; issueId: number | null }>(
    'SELECT c.id AS configId,(SELECT id FROM brews WHERE brew_config_id=c.id ORDER BY generated_at DESC,id DESC LIMIT 1) AS issueId FROM brew_configs c ORDER BY c.id=? DESC,c.id LIMIT 1',
    [saved.configId ?? 0],
  );
  return current
    ? {
        ready: true,
        configId: current.configId,
        ...(current.issueId === null ? {} : { issueId: current.issueId }),
      }
    : { ready: true };
}
/** Resume an interrupted first start; never replace existing subscriptions or recreate deleted samples. */
export async function startBrowserLibrary(api: BrowserApi): Promise<BrowserStart> {
  const done = await browserStartStatus(api);
  if (done.ready) return done;
  const { storage, services, fetching, options } = api;
  const configs = await services.brews.listConfigs();
  let configId = configs.find((config) => config.id === done.configId)?.id ?? configs[0]?.id;
  let feeds = await services.feeds.listFeeds();
  if (!feeds.length && !configId) {
    await storage.batch(
      sampleGroups.map((group) =>
        storage.statement(
          'INSERT INTO feeds(title,url,site_url,description) VALUES(?,?,?,?) ON CONFLICT(url) DO NOTHING',
          [
            group.feedTitle,
            sampleFeedUrl(group.id, options.assetBase),
            options.assetBase,
            'Brew sample feed. Replace it with your own subscriptions in Manage feeds.',
          ],
        ),
      ),
    );
    feeds = await services.feeds.listFeeds();
  }
  const samples = feeds.filter((feed) =>
    sampleGroups.some((group) => feed.url === sampleFeedUrl(group.id, options.assetBase)),
  );
  // Also drains admitted jobs if the previous page closed during initial ingestion.
  for (const feed of samples) await fetching.refresh(feed.id);
  if (!configId) {
    const sections =
      samples.length === sampleGroups.length
        ? sampleGroups.map((group) => {
            const feed = feeds.find(
              (feed) => feed.url === sampleFeedUrl(group.id, options.assetBase),
            )!;
            return {
              ...newBrewSection(group.id),
              title: group.title,
              maxItems: group.end - group.start,
              layout: group.layout,
              depth: 'excerpt' as const,
              onlyUnread: false,
              sources: [{ kind: 'feed' as const, id: feed.id }],
            };
          })
        : [
            {
              ...newBrewSection('reading'),
              title: 'From your feeds',
              maxItems: 20,
              onlyUnread: false,
            },
          ];
    const created = await services.brews.createComposition({
      name: 'Morning',
      enabled: true,
      timezone: options.timezone,
      schedule: { kind: 'daily', time: '07:00' },
      delivery: defaultDelivery(),
      sections,
    });
    configId = created.id;
    await storage.run(
      'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      [key, JSON.stringify({ ready: false, configId })],
    );
  }
  const history = await services.brews.history(configId);
  const issue = history[0] ?? (await services.brews.generateComposition(configId));
  const result = { ready: true, configId, issueId: issue.id };
  await storage.run(
    'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    [key, JSON.stringify(result)],
  );
  return result;
}
