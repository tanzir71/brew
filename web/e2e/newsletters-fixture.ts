import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { openDatabase } from '../../targets/node/src/db/database';
import { createApp } from '../../targets/node/src/app';
import { NewsletterService } from '../../targets/node/src/services/newsletter-service';
import { NewsletterLibrary } from '../../targets/node/src/services/newsletter-library';
import { BrewService } from '../../targets/node/src/services/brew-service';
import { defaultNewsletterSettings } from '../../packages/core/src/types/newsletters';
import { defaultDelivery } from '../../packages/core/src/composition-model';
import { articles, feeds, folders } from '../../targets/node/src/db/schema';

export const newsletterNow = new Date('2026-11-25T08:00:00Z');
export const newsletterTitle = 'Forms should declare their tools';
export async function newslettersFixture(
  page: Page,
  options: { theme?: 'light' | 'dark'; configured?: boolean; empty?: boolean; calm?: boolean } = {},
) {
  process.env.NODE_ENV = 'test';
  const clock = { now: () => new Date(newsletterNow), monotonic: () => 0 };
  const database = openDatabase(':memory:');
  const bytes = fs.readFileSync(
    new URL('../../packages/web/public/figma/newsletters/letter.png', import.meta.url),
  );
  const app = await createApp({
    database,
    clock,
    inbound:
      options.configured === false
        ? null
        : {
            kind: 'postmark',
            address: 'k7f3@in.example.test',
            username: 'test',
            password: 'test-only-password-32',
          },
    fetcher: async (url) =>
      String(url) === 'https://letters.fixture.test/letter.png'
        ? new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/png' } })
        : new Response('', { status: 404 }),
  });
  const brews = new BrewService(database, clock);
  const morning = brews.createComposition({
    name: 'Morning',
    enabled: true,
    timezone: 'UTC',
    schedule: { kind: 'daily', time: '08:00' },
    delivery: defaultDelivery(),
    sections: [],
  });
  const weekend = brews.createComposition({ ...morning, name: 'Weekend', sections: [] });
  const library = new NewsletterLibrary(database, clock);
  const pipeline = new NewsletterService(database, clock);
  const senders = [
    { id: 1, title: 'Interface Letters', address: 'hello@interfaceletters.co' },
    { id: 7, title: 'Low Tide', address: 'letters@lowtide.test' },
    { id: 6, title: 'Field Notes Weekly', address: 'notes@fieldnotes.test' },
    { id: 3, title: 'The Margin', address: 'hello@margin.test' },
    { id: 2, title: 'Common Room', address: 'room@common.test', skip: true },
    { id: 8, title: 'Ledger Daily', address: 'daily@ledger.test', skip: true },
  ];
  if (!options.empty) {
    for (const sender of senders)
      database.db
        .insert(feeds)
        .values({
          id: sender.id,
          title: sender.title,
          kind: 'newsletter',
          url: `mailto:${sender.address}`,
          settingsJson: JSON.stringify({
            ...defaultNewsletterSettings(),
            skipInbox: !!sender.skip,
          }),
        })
        .run();
    const intro =
      'If an agent can fill your checkout, it shouldn’t have to guess what each field means. Labels help people and machines alike, but intent is the missing layer: what happens when this form is sent, and who has to agree to it.';
    const conclusion =
      'This week, three small examples of declaring tools in markup, and why the confirmation step should look exactly like the one a person sees.';
    const first = await pipeline.ingestMessage({
      from: { address: senders[0]!.address },
      messageId: 'forms',
      subject: newsletterTitle,
      date: '2026-11-25T06:12:00Z',
      html: `<p>${intro}</p><img width="446" height="200" src="https://letters.fixture.test/letter.png" alt="An arch in lavender"><p>${conclusion}</p><img width="1" src="https://metrics.test/pixel"><img style="display:none" src="https://metrics.test/hidden"><img src="https://metrics.test/open.gif"><div class="sponsor">A sponsor block in the original</div><footer><a href="https://publisher.test/unsubscribe">Unsubscribe from this letter</a></footer><script>window.letterScript=true</script>`,
    });
    const rest = [
      [
        7,
        'The consent prompt is the product',
        'Every agent API meets the same question: who said yes?',
        '2026-11-25T05:40:00Z',
      ],
      [
        6,
        'Twelve links, one long read',
        'Paper prototypes, an ode to the status bar, and designing for slowness.',
        '2026-11-24T09:00:00Z',
      ],
      [
        3,
        'Pricing pages are getting quieter',
        'Fewer tiers, more honest defaults. Forty pricing pages, three patterns.',
        '2026-11-24T08:00:00Z',
      ],
      [
        1,
        'Annotations are documentation',
        'The best handoff notes live next to the thing they describe.',
        '2026-11-23T08:00:00Z',
      ],
      [
        2,
        'A letter kept out of Inbox',
        'A skipped letter still belongs to your library.',
        '2026-11-22T08:00:00Z',
      ],
      [8, 'A second skipped sender', 'Reading on your terms.', '2026-11-21T08:00:00Z'],
    ] as const;
    for (const [index, [senderId, subject, text, date]] of rest.entries()) {
      const sender = senders.find((item) => item.id === senderId)!;
      const item = await pipeline.ingestMessage({
        from: { address: sender.address },
        messageId: `letter-${index}`,
        subject,
        date,
        html: `<p>${text}</p>`,
      });
      if (index > 0)
        database.sqlite
          .prepare('UPDATE articles SET read_at=? WHERE id=?')
          .run(newsletterNow.getTime(), item.articleId);
    }
    library.updateSender(1, { brewId: morning.id });
    for (const [index, title] of ['Design', 'Engineering', 'Independent', 'Video'].entries()) {
      const folder = database.db
        .insert(folders)
        .values({ title, position: index })
        .returning()
        .get();
      const feed = database.db
        .insert(feeds)
        .values({
          title: `${title} journal`,
          url: `https://rss.fixture.test/${index}`,
          folderId: folder.id,
        })
        .returning()
        .get();
      database.db
        .insert(articles)
        .values({
          feedId: feed.id,
          guid: `rss-${index}`,
          title: `${title} story`,
          url: `https://rss.fixture.test/${index}/story`,
          hash: `rss-${index}`,
          publishedAt: newsletterNow,
        })
        .run();
    }
    if (first.articleId !== 1) throw new Error('Fixture first letter must have a stable ID.');
  }
  await page.addInitScript(
    ({ theme, calm }) => {
      localStorage.setItem('brew:theme', theme);
      localStorage.setItem('brew:calm', String(calm));
    },
    { theme: options.theme ?? 'light', calm: options.calm ?? false },
  );
  await page.clock.setFixedTime(newsletterNow);
  const failures = new Map<string, number>();
  await page.context().route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/events') {
      await route.fulfill({
        contentType: 'text/event-stream',
        body: 'event: heartbeat\ndata: {}\n\n',
      });
      return;
    }
    const key = `${request.method()} ${url.pathname}`;
    if ((failures.get(key) ?? 0) > 0) {
      failures.set(key, failures.get(key)! - 1);
      await route.fulfill({
        status: 503,
        json: { error: 'Temporary fixture failure. Try again.' },
      });
      return;
    }
    const payload = request.postData() ?? undefined;
    const response = await app.inject({
      method: request.method() as 'GET' | 'PATCH' | 'POST' | 'PUT' | 'DELETE',
      url: url.pathname + url.search,
      payload,
      headers: payload ? { 'content-type': 'application/json' } : {},
    });
    await route.fulfill({
      status: response.statusCode,
      body: response.rawPayload,
      headers: Object.fromEntries(
        Object.entries(response.headers)
          .filter(([name]) => !['content-length', 'transfer-encoding', 'connection'].includes(name))
          .map(([key, value]) => [key, String(value)]),
      ),
    });
  });
  return {
    database,
    app,
    library,
    pipeline,
    morning,
    weekend,
    senders,
    brews,
    close: () => app.close(),
    failNext: (method: string, path: string, count = 1) => failures.set(`${method} ${path}`, count),
  };
}
