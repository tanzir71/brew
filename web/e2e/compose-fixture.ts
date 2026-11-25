import type { Page } from '@playwright/test';
import { createApp } from '../../targets/node/src/app';
import { openDatabase } from '../../targets/node/src/db/database';
import { articles, feeds, folders } from '../../targets/node/src/db/schema';
import { BrewService } from '../../targets/node/src/services/brew-service';
import { newBrewSection, defaultDelivery } from '../../packages/core/src/composition-model';
import type { BrewConfigDraft } from '../../packages/core/src/types/brew';

export async function composeFixture(
  page: Page,
  theme = 'light',
  fetcher?: typeof fetch,
  runtime: Pick<
    NonNullable<Parameters<typeof createApp>[0]>,
    'clock' | 'outboundMail' | 'inbound' | 'publicUrl'
  > & {
    previewAt?: () => string;
  } = {},
) {
  process.env.NODE_ENV = 'test';
  const database = openDatabase(':memory:');
  const { previewAt, ...options } = runtime;
  const app = await createApp({ database, fetcher, ...options });
  const design = database.db.insert(folders).values({ title: 'Design' }).returning().get();
  const independent = database.db
    .insert(folders)
    .values({ title: 'Independent' })
    .returning()
    .get();
  const engineering = database.db
    .insert(folders)
    .values({ title: 'Engineering' })
    .returning()
    .get();
  const names = ['Quiet Systems', 'Small Tools Journal', 'Interface Letters', 'The Platform Desk'];
  const sources = names.map((title, index) =>
    database.db
      .insert(feeds)
      .values({
        title,
        url: `https://example.test/feed/${index}`,
        folderId: index === 3 ? engineering.id : index === 1 ? independent.id : design.id,
      })
      .returning()
      .get(),
  );
  const titles = [
    'The quiet structure behind interfaces that feel inevitable',
    'Why the best local-first apps still ship a server',
    'Figma’s variables panel, a month in',
    'A field guide to calm notification design',
    'SQLite in the browser is finally boring',
  ];
  for (let index = 0; index < 5; index++)
    database.db
      .insert(articles)
      .values({
        feedId: sources[index === 4 ? 3 : index % 3]!.id,
        guid: String(index),
        hash: String(index),
        url: `https://example.test/story/${index}`,
        title: titles[index]!,
        author: 'Jo Park',
        summaryHtml:
          index === 0
            ? '<p>Good products rarely announce their structure. They make the next move obvious.</p>'
            : null,
        contentHtml: `<p>Full article ${index}. A careful look at everyday tools.</p>`,
        publishedAt: new Date(Date.parse('2026-11-25T00:00:00Z') - index * 60000),
        imageUrl:
          index === 0
            ? '/figma/compose/lead.svg'
            : index === 1
              ? '/figma/compose/lines.png'
              : index === 2
                ? '/figma/compose/variables.svg'
                : null,
      })
      .run();
  const draft: BrewConfigDraft = {
    name: 'Morning',
    enabled: true,
    timezone: 'Asia/Dhaka',
    schedule: { kind: 'weekdays', time: '07:00', skipIfFewerThan: 5 },
    delivery: { ...defaultDelivery(), feed: true, email: { to: 'reader@example.test' } },
    sections: [
      {
        ...newBrewSection('design'),
        title: 'Design & craft',
        sources: [
          { kind: 'folder', id: design.id },
          { kind: 'folder', id: independent.id },
        ],
        maxItems: 4,
        layout: 'lead',
        filter: {
          match: 'any',
          conditions: [
            { field: 'title', operator: 'contains', value: 'figma' },
            { field: 'author', operator: 'equals', value: 'Jo Park' },
          ],
        },
      },
      {
        ...newBrewSection('letters'),
        title: 'From your newsletters',
        sources: [{ kind: 'newsletters' }],
        layout: 'grid',
        depth: 'brief',
        maxItems: 8,
      },
      {
        ...newBrewSection('engineering'),
        title: 'Engineering',
        sources: [{ kind: 'folder', id: engineering.id }],
        layout: 'headlines',
        depth: 'title',
        maxItems: 5,
      },
      {
        ...newBrewSection('weekly'),
        title: 'Weekly review',
        sources: [{ kind: 'starred' }],
        layout: 'lead',
        maxItems: 3,
        days: [5],
      },
      { ...newBrewSection('note', 'note'), title: 'Note', note: 'One section at a time.' },
    ],
  };
  const config = new BrewService(database).createComposition(draft);
  new BrewService(database).createComposition({ ...draft, name: 'Weekend', sections: [] });
  const puts: BrewConfigDraft[] = [];
  let failSave = false;
  let failPreview = false;
  let pauseSave: (() => Promise<void>) | null = null;
  let pausePreview: (() => Promise<void>) | null = null;
  await page.addInitScript((value) => localStorage.setItem('brew:theme', value), theme);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let payload = request.postData() ?? undefined;
    if (url.pathname.endsWith('/composition') && request.method() === 'PUT') {
      puts.push(JSON.parse(payload!));
      if (pauseSave) {
        const pause = pauseSave;
        pauseSave = null;
        await pause();
      }
      if (failSave) {
        failSave = false;
        await route.fulfill({ status: 503, json: { error: 'Save unavailable. Try again.' } });
        return;
      }
    }
    if (url.pathname.endsWith('/preview')) {
      payload = JSON.stringify({
        ...JSON.parse(payload!),
        at: previewAt?.() ?? '2026-11-25T01:00:00Z',
      });
      if (pausePreview) {
        const pause = pausePreview;
        pausePreview = null;
        await pause();
      }
      if (failPreview) {
        failPreview = false;
        await route.fulfill({ status: 422, json: { error: 'Preview unavailable.' } });
        return;
      }
    }
    const response = await app.inject({
      method: request.method() as 'GET' | 'POST' | 'PUT' | 'DELETE',
      url: url.pathname + url.search,
      payload,
      headers: {
        ...(payload
          ? { 'content-type': request.headers()['content-type'] ?? 'application/json' }
          : {}),
        ...Object.fromEntries(
          Object.entries(request.headers()).filter(
            ([name]) => name === 'authorization' || name.startsWith('x-mailgun-'),
          ),
        ),
      },
    });
    await route.fulfill({
      status: response.statusCode,
      body: response.body,
      headers: Object.fromEntries(
        Object.entries(response.headers)
          .filter(([name]) => !['content-length', 'transfer-encoding', 'connection'].includes(name))
          .map(([key, value]) => [key, String(value)]),
      ),
    });
  });
  return {
    config,
    database,
    puts,
    close: () => app.close(),
    failNextSave: () => {
      failSave = true;
    },
    failNextPreview: () => {
      failPreview = true;
    },
    holdSave: (pause: () => Promise<void>) => {
      pauseSave = pause;
    },
    holdPreview: (pause: () => Promise<void>) => {
      pausePreview = pause;
    },
  };
}
