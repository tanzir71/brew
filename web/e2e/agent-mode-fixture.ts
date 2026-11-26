import type { Page } from '@playwright/test';
import { newslettersFixture, newsletterNow } from './newsletters-fixture';
import { articles, feeds, folders } from '../../targets/node/src/db/schema';

export async function agentModeFixture(page: Page, theme: 'light' | 'dark' = 'light') {
  const f = await newslettersFixture(page, { empty: true, theme });
  const folder = f.database.db.insert(folders).values({ title: 'Agent library' }).returning().get();
  const feed = f.database.db
    .insert(feeds)
    .values({ title: 'Agent source', url: 'https://agent.fixture.test/feed', folderId: folder.id })
    .returning()
    .get();
  f.database.db
    .insert(articles)
    .values(
      Array.from({ length: 121 }, (_, i) => ({
        feedId: feed.id,
        guid: `agent-mode-${i}`,
        hash: `agent-mode-${i}`,
        title: `Agent story ${String(i + 1).padStart(3, '0')}`,
        url: `https://agent.fixture.test/${i}`,
        summaryHtml: '<p>Page the library without changing read state.</p>',
        contentHtml: '<p>A complete local story for the agent-mode journey.</p>',
        publishedAt: new Date(newsletterNow.getTime() - i * 60_000),
        starredAt: i % 50 === 0 ? newsletterNow : null,
      })),
    )
    .run();
  return { ...f, folder, feed };
}
