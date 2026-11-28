import type { ParsedFeedDocument } from './feed-parser.js';

/** Original Brew example copy. Samples are local subscriptions, not a remote publisher. */
export const sampleTitles = [
  [
    'The quiet structure behind interfaces that feel inevitable',
    'Quiet Systems',
    'Good products rarely announce their structure. They make the next move obvious, and that takes more editing than invention.',
  ],
  [
    'Why the best local-first apps still ship a server',
    'Small Tools Journal',
    'A file you own is the start, not the end. Sync, backups and sharing still need somewhere to live.',
  ],
  [
    'Figma’s variables panel, a month in',
    'Interface Letters',
    'Modes finally feel like a first-class idea. Aliasing across collections is still the sharp edge.',
  ],
  [
    'A field guide to calm notification design',
    'Paperwork',
    'Interruptions should earn their place. Most of them can wait for the next Brew.',
  ],
  [
    'Forms should declare their tools',
    'Interface Letters',
    'If an agent can fill your checkout, it shouldn’t have to guess what each field means. A short case for declaring intent in markup.',
  ],
  [
    'The consent prompt is the product',
    'Low Tide',
    'Every agent API meets the same question: who said yes? How browsers are designing the permission moment.',
  ],
  [
    'Twelve links, one long read',
    'Field Notes Weekly',
    'Paper prototypes, an ode to the status bar, and a long interview on designing for slowness.',
  ],
  [
    'Pricing pages are getting quieter',
    'The Margin',
    'Fewer tiers, more honest defaults. Forty pricing pages from this year, three patterns.',
  ],
  ['SQLite in the browser is finally boring', 'Northwind Dispatch', ''],
  ['Cron, queues and the 10 ms budget', 'The Platform Desk', ''],
  ['Shipping one codebase to five runtimes', 'Small Tools Journal', ''],
  ['What we learned rewriting our feed parser', 'Afterglow', ''],
  ['Readable diffs for configuration files', 'Paperwork', ''],
];

export const sampleGroups = [
  {
    id: 'design',
    title: 'Design & craft',
    feedTitle: 'Design sample',
    start: 0,
    end: 4,
    layout: 'lead',
  },
  {
    id: 'reading',
    title: 'From your feeds',
    feedTitle: 'Reading sample',
    start: 4,
    end: 8,
    layout: 'grid',
  },
  {
    id: 'engineering',
    title: 'Engineering',
    feedTitle: 'Engineering sample',
    start: 8,
    end: 13,
    layout: 'headlines',
  },
] as const;
export function sampleFeedUrl(group: string, base: string) {
  return new URL('samples/' + group + '.json', base).href;
}
export function sampleDocument(
  groupId: string,
  base: string,
  at = new Date(),
): ParsedFeedDocument | null {
  const group = sampleGroups.find((group) => group.id === groupId);
  if (!group) return null;
  return {
    title: group.feedTitle,
    siteUrl: base,
    description:
      'Brew sample articles, stored on this device. Add your own subscriptions when you are ready.',
    articles: sampleTitles
      .slice(group.start, group.end)
      .map(([title, publisher, excerpt], localIndex) => {
        const index = group.start + localIndex;
        const image =
          index === 0
            ? 'lead-light.svg'
            : index === 1
              ? 'lines-light.png'
              : index === 2
                ? 'variables-light.svg'
                : index === 3
                  ? 'notifications-light.svg'
                  : null;
        const picture = image
          ? '<img src="' + new URL('figma/read/' + image, base).href + '" alt="">'
          : '';
        return {
          guid: 'brew-sample-' + index,
          url: new URL('samples/' + group.id + '-' + localIndex + '.html', base).href,
          title: title!,
          author: publisher!,
          summaryHtml: excerpt ? '<p>' + excerpt + '</p>' : null,
          contentHtml:
            picture +
            '<p>' +
            (excerpt || 'A sample story to try reading, saving and organizing your first Brew.') +
            '</p><p>This is a Brew sample. Replace these subscriptions with your own feeds in Manage feeds.</p>',
          publishedAt: new Date(at.getTime() - index * 60_000),
        };
      }),
  };
}
export function sampleFeed(group: string, base: string, at = new Date()) {
  const document = sampleDocument(group, base, at);
  if (!document) return null;
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: document.title,
    home_page_url: base,
    description: document.description,
    feed_url: sampleFeedUrl(group, base),
    items: document.articles.map((article) => ({
      id: article.guid,
      url: article.url,
      title: article.title,
      authors: [{ name: article.author }],
      content_html: article.contentHtml,
      summary: article.summaryHtml,
      date_published: article.publishedAt.toISOString(),
    })),
  };
}
