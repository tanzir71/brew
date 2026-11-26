import { newBrewSection } from '../src/composition-model.js';
import { cleanNewsletterHtml } from '../src/newsletter-cleaner.js';
import type { BrewSnapshot, BrewSnapshotItem, BrewSnapshotSection } from '../src/types/brew.js';
import { newsletterCorpus } from './newsletter-corpus.js';

// Synthetic frozen content only. Never fetch these reserved publisher/instance URLs.
export const outputOrigin = 'https://brew.example.test';
export const outputArticle = (values: Partial<BrewSnapshotItem> = {}): BrewSnapshotItem => ({
  id: 81,
  title: 'A slower web & the tools we keep',
  url: 'https://journal.test/story?chapter=2',
  author: 'Jo Park',
  publishedAt: '2026-11-25T18:00:00Z',
  readAt: null,
  feedTitle: 'Quiet Systems',
  readTimeMinutes: 3,
  imageUrl: null,
  summaryHtml: '<p>Small, <strong>durable tools</strong> make room for a quieter day.</p>',
  contentHtml:
    '<p>Read <em>slowly</em>, with <a href="/a/81">context</a>. বাংলা · 日本語 · 😌</p><ul><li>Keep the useful parts.<ul><li>Leave room to think.</li></ul></li><li>Make the next step clear.</li></ul><blockquote>A little less, a little better.</blockquote><pre><code>if (ready) {\n  read();\n}</code></pre><table><tr><th>Tool</th><th>Purpose</th></tr><tr><td>Notebook</td><td>Remember</td></tr></table>',
  ...values,
});
const section = (id: string, values: Partial<BrewSnapshotSection> = {}): BrewSnapshotSection => ({
  ...newBrewSection(id),
  title: id,
  depth: 'full',
  matchingItems: 1,
  eligibleItems: 1,
  items: [outputArticle()],
  ...values,
});
export function readingOutputFixture(): BrewSnapshot {
  return {
    version: 2,
    id: 501,
    issueNumber: 8,
    brewConfigId: 17,
    configName: 'Weekend & reading',
    generatedAt: '2026-11-25T20:00:00Z',
    timezone: 'Asia/Dhaka',
    scrollPosition: 275,
    sections: [
      section('Design & craft', {
        id: 'design',
        layout: 'lead',
        items: [outputArticle({ imageUrl: 'https://journal.test/forest.jpg' })],
      }),
      section('Small tools', {
        id: 'tools',
        layout: 'magazine',
        depth: 'excerpt',
        items: [outputArticle({ id: 82, title: 'A notebook for small discoveries' })],
      }),
      section('From your newsletters', {
        id: 'letters',
        layout: 'grid',
        depth: 'title',
        images: false,
        items: [outputArticle({ id: 83, title: 'Three ideas for the weekend', url: '/a/83' })],
      }),
      section('Engineering', {
        id: 'engineering',
        layout: 'headlines',
        depth: 'brief',
        images: false,
        items: [outputArticle({ id: 84, title: 'The quiet work of keeping things running' })],
      }),
      section('A note', {
        id: 'note',
        kind: 'note',
        items: [],
        noteHtml: '<p>One section at a time. <a href="/b/17">Browse the archive</a>.</p>',
      }),
      section('Until next time', { id: 'divider', kind: 'divider', items: [] }),
      section('Saved for later', { id: 'empty', items: [] }),
    ],
  };
}
export function newsletterOutputFixture(): BrewSnapshot {
  return {
    ...readingOutputFixture(),
    id: 499,
    issueNumber: 7,
    generatedAt: '2026-11-24T20:00:00Z',
    sections: [
      section('From your newsletters', {
        id: 'corpus',
        layout: 'grid',
        matchingItems: newsletterCorpus.length,
        eligibleItems: newsletterCorpus.length,
        items: newsletterCorpus.map((sample, index) => {
          const clean = cleanNewsletterHtml(sample.html, sample.selectors);
          return outputArticle({
            id: 100 + index,
            title: sample.name,
            feedTitle: 'Fixture Journal',
            url: `/a/${100 + index}`,
            imageUrl: null,
            summaryHtml: clean.html,
            contentHtml: clean.html,
          });
        }),
      }),
    ],
  };
}
export function emptyOutputFixture(): BrewSnapshot {
  return { ...readingOutputFixture(), id: 502, issueNumber: 9, sections: [] };
}
export const outputFixtures = [
  { name: 'reading', make: readingOutputFixture },
  { name: 'newsletters', make: newsletterOutputFixture },
  { name: 'empty', make: emptyOutputFixture },
];
