import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { newslettersFixture } from './newsletters-fixture';
import { readFixture } from './read-fixture';
import { newsletterCorpus } from '../../packages/core/test/newsletter-corpus';
import { NodeNewsletterStorage } from '../../targets/node/src/ports/newsletter-storage';
import { articles, feeds } from '../../targets/node/src/db/schema';
import type { BrewSection } from '../../packages/core/src/types/brew';
import { newBrewSection } from '../../packages/core/src/composition-model';

export const exitNow = new Date('2026-11-25T01:00:00Z');
const clock = { now: () => new Date(exitNow), monotonic: () => 0 };
export async function newsletterExitFixture(
  page: Page,
  theme: 'light' | 'dark' = 'light',
  corpus = false,
) {
  const fetched: string[] = [];
  const bytes = fs.readFileSync(
    new URL('../../packages/web/public/figma/newsletters/letter.png', import.meta.url),
  );
  const fixture = await newslettersFixture(page, {
    empty: true,
    theme,
    clock,
    fetcher: async (input) => {
      const url = String(input);
      fetched.push(url);
      return url === 'https://journal.test/photo.jpg'
        ? new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/png' } })
        : new Response('', { status: 404 });
    },
  });
  const mail: Array<{
    id: number;
    name: string;
    expected: (typeof newsletterCorpus)[number] | null;
  }> = [];
  const mime = (address: string, name: string, title: string, date: string, html: string) =>
    `From: ${name} <${address}>\r\nSubject: ${title}\r\nMessage-ID: <${address}>\r\nDate: ${new Date(date).toUTCString()}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}`;
  if (corpus) {
    const storage = new NodeNewsletterStorage(fixture.database);
    for (const [index, sample] of newsletterCorpus.entries()) {
      const address = `sender${index}@journal.test`;
      const feed = storage.ensureSender({ address, name: sample.name });
      if (sample.selectors) fixture.library.updateSender(feed.id, { cleaning: sample.selectors });
      // Complete mail envelopes around the shared publisher-shaped cases. The
      // adversarial head/body must remain untrusted in every product surface.
      const html = `<!doctype html><html><head><style>@import url(https://metrics.test/style);body{font-style:italic;background:url(https://metrics.test/background)}</style></head><body><table role="presentation"><tr><td><h2>Journal · ${sample.name}</h2></td></tr><tr><td>${sample.html}</td></tr></table><script>window.corpusExecuted=true</script><iframe src="https://metrics.test/frame"></iframe></body></html>`;
      const result = await fixture.pipeline.ingest(
        mime(address, sample.name, sample.name, exitNow.toISOString(), html),
      );
      mail.push({ id: result.articleId!, name: sample.name, expected: sample });
    }
  } else {
    const publishers = [
      {
        id: 1,
        name: 'Interface Letters',
        title: 'Forms should declare their tools',
        date: '2026-11-25T00:12:00Z',
        text: 'If an agent can fill your checkout, it shouldn’t have to guess what each field means. A short case for declaring intent in markup.',
        extra:
          '<img width="1" src="https://metrics.test/one"><img width="1" src="https://metrics.test/two"><img width="1" src="https://metrics.test/three">',
      },
      {
        id: 7,
        name: 'Low Tide',
        title: 'The consent prompt is the product',
        date: '2026-11-24T23:40:00Z',
        text: 'Every agent API meets the same question: who said yes? How browsers are designing the permission moment.',
        extra: '<div class="sponsor">Buy a secretadtoken</div>',
      },
      {
        id: 5,
        name: 'Field Notes Weekly',
        title: 'Twelve links, one long read',
        date: '2026-11-24T03:00:00Z',
        text: 'Paper prototypes, an ode to the status bar, and a long interview on designing for slowness.',
        extra: Array.from(
          { length: 5 },
          (_, i) => `<img width="1" src="https://metrics.test/${i}">`,
        ).join(''),
      },
      {
        id: 3,
        name: 'The Margin',
        title: 'Pricing pages are getting quieter',
        date: '2026-11-24T02:00:00Z',
        text: 'Fewer tiers, more honest defaults. Forty pricing pages from this year, three patterns.',
        extra: '<footer><a href="https://journal.test/unsubscribe">Unsubscribe</a></footer>',
      },
    ];
    for (const publisher of publishers) {
      const address = `letters${publisher.id}@journal.test`;
      fixture.database.db
        .insert(feeds)
        .values({
          id: publisher.id,
          title: publisher.name,
          url: `mailto:${address}`,
          kind: 'newsletter',
        })
        .run();
      const result = await fixture.pipeline.ingest(
        mime(
          address,
          publisher.name,
          publisher.title,
          publisher.date,
          `<p>${publisher.text}</p>${publisher.extra}`,
        ),
      );
      mail.push({ id: result.articleId!, name: publisher.title, expected: null });
    }
    const sample = readFixture(theme);
    for (const [index, item] of [...sample.items.slice(0, 4), ...sample.items.slice(8)].entries()) {
      const feed = fixture.database.db
        .insert(feeds)
        .values({ title: item.feedTitle, url: `https://rss.fixture.test/${index}` })
        .returning()
        .get();
      fixture.database.db
        .insert(articles)
        .values({
          feedId: feed.id,
          guid: String(index),
          hash: `rss-${index}`,
          title: item.title,
          url: item.url,
          summaryHtml: item.summaryHtml,
          contentHtml: item.summaryHtml ?? '<p>A quiet engineering story.</p>',
          imageUrl: item.imageUrl,
          publishedAt: new Date(exitNow.getTime() - (index + 1) * 60_000),
          readAt: [3, 4, 5, 6, 7].includes(index) ? exitNow : null,
        })
        .run();
    }
  }
  const rssIds = (
    fixture.database.sqlite
      .prepare(
        "SELECT a.id FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE f.kind='rss' ORDER BY a.id",
      )
      .all() as Array<{ id: number }>
  ).map((row) => row.id);
  const sections: BrewSection[] = corpus
    ? []
    : [
        {
          ...newBrewSection('design'),
          title: 'Design & craft',
          sources: rssIds.slice(0, 4).map((id) => ({
            kind: 'feed' as const,
            id: (
              fixture.database.sqlite
                .prepare('SELECT feed_id AS id FROM articles WHERE id=?')
                .get(id) as { id: number }
            ).id,
          })),
          layout: 'lead' as const,
          maxItems: 4,
          onlyUnread: false,
        },
      ];
  sections.push({
    ...newBrewSection('letters'),
    title: 'From your newsletters',
    sources: [{ kind: 'newsletters' }],
    layout: 'grid',
    depth: corpus ? 'full' : 'excerpt',
    maxItems: corpus ? 20 : 4,
    onlyUnread: false,
  });
  if (!corpus)
    sections.push({
      ...newBrewSection('engineering'),
      title: 'Engineering',
      sources: rssIds.slice(4).map((id) => ({
        kind: 'feed' as const,
        id: (
          fixture.database.sqlite
            .prepare('SELECT feed_id AS id FROM articles WHERE id=?')
            .get(id) as { id: number }
        ).id,
      })),
      layout: 'headlines',
      depth: 'title',
      maxItems: 5,
      onlyUnread: false,
    });
  fixture.brews.updateComposition(fixture.morning.id, {
    ...fixture.morning,
    timezone: 'Asia/Dhaka',
    schedule: { kind: 'daily', time: '07:00' },
    sections,
  });
  const issue = await fixture.brews.generateComposition(fixture.morning.id);
  return {
    ...fixture,
    issue,
    mail,
    fetched,
    frozen: (
      fixture.database.sqlite
        .prepare('SELECT payload_json AS payload FROM brews WHERE id=?')
        .get(issue.id) as { payload: string }
    ).payload,
    frozenPayload: () =>
      (
        fixture.database.sqlite
          .prepare('SELECT payload_json AS payload FROM brews WHERE id=?')
          .get(issue.id) as { payload: string }
      ).payload,
  };
}
