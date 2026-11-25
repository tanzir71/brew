import { upgradeLegacyDraft } from '../../packages/core/src/composition-model';
import { nodeCapabilities } from '../../targets/node/src/capabilities';
import type { Page } from '@playwright/test';
import type {
  BrewConfig,
  BrewItem,
  BrewReadState,
  BrewSnapshot,
} from '../../packages/core/src/types/legacy-brew';

const titles = [
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
export function readFixture(theme = 'light') {
  const items: BrewItem[] = titles.map(([title, feedTitle, excerpt], index) => ({
    id: index + 1,
    title: title!,
    feedTitle: feedTitle!,
    summaryHtml: excerpt ? `<p>${excerpt}</p>` : null,
    url: `https://example.test/${index + 1}`,
    author: null,
    publishedAt: '2026-11-25T00:00:00.000Z',
    readTimeMinutes: [6, 5, 7, 4, 3, 4, 8, 5, 6, 8, 11, 5, 3][index]!,
    readAt: null,
    imageUrl:
      index === 0
        ? `/figma/read/lead-${theme}.svg`
        : index === 1
          ? `/figma/read/lines-${theme}.png`
          : index === 2
            ? `/figma/read/variables-${theme}.svg`
            : index === 3
              ? `/figma/read/notifications-${theme}.svg`
              : null,
  }));
  const config: BrewConfig = {
    id: 1,
    name: 'Morning',
    scheduleCron: '0 7 * * *',
    enabled: true,
    createdAt: '2026-11-01T00:00:00.000Z',
    sections: [
      {
        id: 'design',
        title: 'Design & craft',
        source: 'today',
        maxItems: 4,
        layout: 'lead',
        sort: 'newest',
        onlyUnread: false,
      },
      {
        id: 'grid',
        title: 'From your feeds',
        source: 'today',
        maxItems: 4,
        layout: 'grid',
        sort: 'newest',
        onlyUnread: false,
      },
      {
        id: 'engineering',
        title: 'Engineering',
        source: 'today',
        maxItems: 5,
        layout: 'headlines',
        sort: 'newest',
        onlyUnread: false,
      },
    ],
  };
  const issue: BrewSnapshot = {
    id: 214,
    brewConfigId: 1,
    configName: 'Morning',
    generatedAt: '2026-11-25T01:00:00.000Z',
    scrollPosition: 0,
    sections: config.sections.map((section, index) => ({
      ...section,
      items: index === 0 ? items.slice(0, 4) : index === 1 ? items.slice(4, 8) : items.slice(8),
    })),
  };
  const state: BrewReadState = {
    articles: items.map((item) => ({
      id: item.id,
      feedId: titles.findIndex((entry) => entry[1] === item.feedTitle) + 1,
      available: true,
      readAt: [4, 8, 9, 10, 11].includes(item.id) ? '2026-11-25T01:00:00.000Z' : null,
      starredAt: null,
      highlightColor: item.id === 3 ? '#6e9278' : null,
      rules: item.id === 3 ? [{ id: 7, name: 'Figma mentions' }] : [],
    })),
    timeZone: 'Asia/Dhaka',
    nextAt: '2026-11-26T01:00:00.000Z',
    scheduleLabel: 'Daily',
  };
  return { items, config, issue, state };
}
export async function mockRead(page: Page, theme = 'light') {
  const fixture = readFixture(theme);
  let failUpdate = false;
  await page.addInitScript((value) => {
    localStorage.setItem('brew:theme', value);
    localStorage.setItem(
      'brew:saved-searches',
      JSON.stringify([{ id: 'figma', name: 'Figma mentions', query: 'Figma' }]),
    );
  }, theme);
  await page.route('**/api/capabilities', (route) => route.fulfill({ json: nodeCapabilities() }));
  await page.route('**/api/brew-configs/1/composition', (route) =>
    route.fulfill({
      json: {
        ...fixture.config,
        ...upgradeLegacyDraft(fixture.config, 'Asia/Dhaka'),
        delivery: { web: true, feed: true, publicCopy: false },
      },
    }),
  );
  await page.route('**/api/brew-configs', (route) =>
    route.fulfill({ json: [fixture.config, { ...fixture.config, id: 2, name: 'Weekend' }] }),
  );
  await page.route('**/api/brew-configs/1/history', (route) =>
    route.fulfill({
      json: [fixture.issue, { ...fixture.issue, id: 213, generatedAt: '2026-11-24T01:00:00.000Z' }],
    }),
  );
  await page.route('**/api/brew-configs/2/history', (route) =>
    route.fulfill({
      json: [{ ...fixture.issue, id: 215, brewConfigId: 2, configName: 'Weekend' }],
    }),
  );
  await page.route('**/api/brews/*/state', (route) => route.fulfill({ json: fixture.state }));
  await page.route('**/api/reader/navigation', (route) =>
    route.fulfill({
      json: {
        counts: { all: 312, today: 34, starred: 9 },
        folders: [
          { id: 1, title: 'Design', unreadCount: 18, feeds: [] },
          { id: 2, title: 'Engineering', unreadCount: 41, feeds: [] },
          { id: 3, title: 'Independent', unreadCount: 12, feeds: [] },
          { id: 4, title: 'Video', unreadCount: 5, feeds: [] },
        ],
        unfiled: [],
      },
    }),
  );
  await page.route('**/api/tags', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/brews/*/scroll', (route) => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/articles/*', (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/').at(-1));
    const state = fixture.state.articles.find((item) => item.id === id)!;
    if (route.request().method() === 'PATCH') {
      if (failUpdate) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
      const body = route.request().postDataJSON();
      if (body.read !== undefined) state.readAt = body.read ? '2026-11-25T02:00:00.000Z' : null;
      if (body.starred !== undefined)
        state.starredAt = body.starred ? '2026-11-25T02:00:00.000Z' : null;
    }
    return route.fulfill({
      json: {
        ...fixture.items.find((item) => item.id === id),
        ...state,
        fullTextHtml: '<p>Locally read article content.</p>',
        tags: [],
      },
    });
  });
  return {
    ...fixture,
    failUpdates: (value: boolean) => {
      failUpdate = value;
    },
  };
}
