import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { newslettersFixture } from './newsletters-fixture';
import { seedRuleHistory } from './rule-history-fixture';
import { feeds } from '../../targets/node/src/db/schema';
import { newBrewSection } from '../../packages/core/src/composition-model';

for (const theme of ['light', 'dark'] as const) {
  test(`execution totals, native pages and legacy landmarks remain accessible in ${theme}`, async ({
    page,
  }, info) => {
    const f = await newslettersFixture(page, { theme });
    try {
      const { rule } = seedRuleHistory(f);
      const before = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
      await page.goto(`/rules/${rule.id}?tab=log&agent=1`);
      await expect(page.getByRole('main', { name: 'Rules', exact: true })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Library', exact: true })).toBeVisible();
      await expect(page.getByRole('status', { name: 'Saved rule total', exact: true })).toHaveText(
        '1 saved rule',
      );
      const log = page.getByRole('region', { name: 'Rule execution log', exact: true });
      const range = log.getByRole('status', { name: 'Execution range', exact: true });
      await expect(range).toHaveText('Showing 1–50 of 126 executions');
      await expect(log.getByRole('article')).toHaveCount(50);
      await expect(log.getByRole('article').first()).toHaveAttribute('data-brew-kind', 'rule-log');
      await expect(log.getByRole('article', { name: 'Execution 126', exact: true })).toBeVisible();
      await page.getByLabel('Rule name', { exact: true }).fill('Unsaved history draft');
      await log.getByRole('link', { name: 'Next', exact: true }).click();
      await expect(range).toHaveText('Showing 51–100 of 126 executions');
      await expect(
        log.getByRole('heading', { name: 'Recent executions', exact: true }),
      ).toBeFocused();
      await expect(page).toHaveURL(new RegExp(`/rules/${rule.id}\\?tab=log&page=2&agent=1$`));
      await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue(
        'Unsaved history draft',
      );
      await expect(log.getByRole('link', { name: 'JSON', exact: true })).toHaveAttribute(
        'href',
        `/rules/${rule.id}.json?tab=log&page=2&agent=1`,
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({ path: info.outputPath(`rule-history-${theme}.png`) });
      await page.setViewportSize({ width: 390, height: 844 });
      await log.getByRole('link', { name: 'Page 3', exact: true }).click();
      await expect(range).toHaveText('Showing 101–126 of 126 executions');
      await expect(log.getByRole('article')).toHaveCount(26);
      await expect(log.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
      await log.scrollIntoViewIfNeeded();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({ path: info.outputPath(`rule-history-phone-${theme}.png`) });
      await page.goBack();
      await expect(range).toHaveText('Showing 51–100 of 126 executions');
      await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue(
        'Unsaved history draft',
      );
      await page.reload();
      await expect(range).toHaveText('Showing 51–100 of 126 executions');
      await page.goto('/rules?agent=1');
      await page.getByRole('button', { name: 'New rule', exact: true }).click();
      const visible = (
        f.database.sqlite.prepare('SELECT count(*) AS n FROM articles WHERE hidden=0').get() as {
          n: number;
        }
      ).n;
      await expect(
        page.getByRole('heading', { name: `Would match ${visible}`, exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Show all matches', exact: true }).click();
      await expect(page.getByRole('status', { name: 'Preview range', exact: true })).toHaveText(
        `Showing 1–50 of ${visible} matching articles`,
      );
      expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    } finally {
      await f.close();
    }
  });
}
test('failed rules and execution reads retain known totals or offer retry without false counts', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const { rule, service } = seedRuleHistory(f);
    await page.goto(`/rules/${rule.id}?tab=log`);
    const range = page.getByRole('status', { name: 'Execution range', exact: true });
    await expect(range).toHaveText('Showing 1–50 of 126 executions');
    await page.getByLabel('Rule name', { exact: true }).fill('Retained draft');
    f.failNext('GET', '/api/rules');
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh rules', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Rule templates and settings', exact: true })
      .getByRole('button', { name: 'Close Rule templates and settings', exact: true })
      .click();
    await expect(page.getByRole('status', { name: 'Saved rule total', exact: true })).toHaveText(
      '1 saved rule · Last loaded',
    );
    service.create({ ...service.list()[0]!, name: 'Another saved rule' });
    await page.getByRole('button', { name: 'Retry rules', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Saved rule total', exact: true })).toHaveText(
      '2 saved rules',
    );
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue('Retained draft');
    f.failNext('GET', `/api/rules/${rule.id}/executions`);
    await page
      .getByRole('navigation', { name: 'Execution pages', exact: true })
      .getByRole('link', { name: 'Next', exact: true })
      .click();
    await expect(page.getByRole('button', { name: 'Retry executions', exact: true })).toBeVisible();
    await expect(range).toHaveCount(0);
    await expect(page.getByText('No executions yet.', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry executions', exact: true }).click();
    await expect(range).toHaveText('Showing 51–100 of 126 executions');
    await expect(
      page.getByRole('heading', { name: 'Recent executions', exact: true }),
    ).toBeFocused();
    await page.goto(`/rules/${rule.id}?tab=log&page=9`);
    await expect(range).toHaveText('Showing 0–0 of 126 executions');
    await page.getByRole('link', { name: 'First page', exact: true }).click();
    await expect(range).toHaveText('Showing 1–50 of 126 executions');
  } finally {
    await f.close();
  }
});
test('a late execution read preserves the newer editor focus and browser history cancels obsolete page focus', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  try {
    const { rule } = seedRuleHistory(f);
    await page.route(`**/api/rules/${rule.id}/executions?page=2`, async (route) => {
      started();
      await held;
      await route.fallback();
    });
    await page.goto(`/rules/${rule.id}?tab=log`);
    await page.getByRole('link', { name: 'Next', exact: true }).click();
    await waiting;
    await page.getByLabel('Rule name', { exact: true }).fill('Newer editor focus');
    release();
    await expect(page.getByRole('status', { name: 'Execution range', exact: true })).toHaveText(
      'Showing 51–100 of 126 executions',
    );
    await expect(page.getByLabel('Rule name', { exact: true })).toBeFocused();
    await page.goBack();
    await expect(page.getByRole('status', { name: 'Execution range', exact: true })).toHaveText(
      'Showing 1–50 of 126 executions',
    );
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue('Newer editor focus');
  } finally {
    release();
    await f.close();
  }
});
test('Undo retry recovers a lost acknowledgement and focuses its result after reload', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const { service } = seedRuleHistory(f, 0);
    await page.goto('/rules');
    await page
      .getByRole('article', { name: 'History rule', exact: true })
      .getByRole('button', { name: 'Copy', exact: true })
      .click();
    await expect(
      page.getByRole('article', { name: 'History rule copy', exact: true }),
    ).toBeVisible();
    await page.reload();
    let lost = true;
    await page.route('**/api/actions/*/undo', async (route) => {
      const response = await f.app.inject({
        method: 'POST',
        url: new URL(route.request().url()).pathname,
        payload: {},
      });
      if (lost) {
        lost = false;
        return route.abort('failed');
      }
      return route.fulfill({ status: response.statusCode, json: response.json() });
    });
    const undo = page.getByRole('button', { name: 'Undo', exact: true });
    await undo.focus();
    await page.keyboard.press('Enter');
    await expect(undo).toBeEnabled();
    await expect(page.getByRole('alert')).toBeVisible();
    expect(service.list()).toHaveLength(1);
    await expect(undo).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(undo).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Action result', exact: true })).toBeFocused();
    await expect(page.getByRole('region', { name: 'Action result', exact: true })).toContainText(
      'Undid local changes.',
    );
  } finally {
    await f.close();
  }
});
test('late feed Undo preserves newer toolbar focus while restoring the actual feed', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  try {
    const feed = f.database.db
      .insert(feeds)
      .values({ title: 'Undo focus feed', url: 'https://undo-focus.test/feed' })
      .returning()
      .get();
    await page.goto('/feeds');
    await page
      .getByRole('article', { name: feed.title, exact: true })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: `Delete ${feed.title}?`, exact: true })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect(page.getByRole('article', { name: feed.title, exact: true })).toHaveCount(0);
    await page.route('**/api/actions/*/undo', async (route) => {
      const response = await f.app.inject({
        method: 'POST',
        url: new URL(route.request().url()).pathname,
        payload: {},
      });
      started();
      await held;
      await route.fulfill({ status: response.statusCode, json: response.json() });
    });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await waiting;
    const search = page.getByRole('searchbox', { name: 'Search library', exact: true });
    await search.fill('Retain toolbar focus');
    release();
    await expect(page.getByRole('article', { name: feed.title, exact: true })).toBeVisible();
    await expect(search).toBeFocused();
  } finally {
    release();
    await f.close();
  }
});
for (const group of ['reading', 'library', 'filtered'] as const)
  test(`current ${group} screens expose one main, Library navigation and native named controls with stable content identities`, async ({
    page,
  }) => {
    const f = await newslettersFixture(page);
    try {
      seedRuleHistory(f, 0);
      f.brews.updateComposition(f.morning.id, {
        ...f.brews.composition(f.morning.id)!,
        sections: [
          {
            ...newBrewSection('audit'),
            title: 'Audit section',
            sources: [{ kind: 'feed', id: 1 }],
          },
        ],
      });
      const generation = await f.app.inject({
        method: 'POST',
        url: `/api/brew-configs/${f.morning.id}/generate`,
        payload: {},
      });
      expect(generation.statusCode).toBe(200);
      const before = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
      const paths =
        group === 'reading'
          ? [`/b/${f.morning.id}/1`, `/b/${f.morning.id}/compose`, '/all', '/search?q=Forms']
          : group === 'library'
            ? ['/letters', '/rules', '/feeds', '/settings/runs']
            : ['/feeds?section=health', '/feeds?section=hidden', '/letters?view=favorites'];
      for (const path of paths) {
        await page.goto(`${path}${path.includes('?') ? '&' : '?'}agent=1`);
        const main = page.getByRole('main');
        await expect(main).toHaveCount(1);
        await expect(page.getByRole('navigation', { name: 'Library', exact: true })).toHaveCount(1);
        if (!path.startsWith('/rules') && !path.startsWith('/feeds'))
          await expect(
            page.getByRole('link', { name: 'Node · Where Brew runs', exact: true }),
          ).toBeVisible();
        if (path === '/settings/runs') {
          await expect(
            page.getByRole('heading', { name: 'Node / Docker', exact: true }),
          ).toBeVisible();
          await expect(
            page.getByRole('button', { name: 'Refresh capabilities', exact: true }),
          ).toBeEnabled();
        }
        if (path === '/rules')
          await expect(
            page.getByRole('status', { name: 'Saved rule total', exact: true }),
          ).toHaveText('1 saved rule');
        if (path.endsWith('/1'))
          await expect(
            page.getByRole('complementary', { name: 'In this Brew', exact: true }),
          ).toBeVisible();
        const buttons = page.getByRole('button');
        await expect(page.getByRole('button', { name: /^\s*$/ })).toHaveCount(0);
        for (const button of await buttons.evaluateAll((elements) =>
          elements.map((element) => ({
            tag: element.tagName,
            text: element.textContent?.trim() ?? '',
            label: element.getAttribute('aria-label') || element.getAttribute('aria-labelledby'),
          })),
        )) {
          expect(button.tag).toBe('BUTTON');
          if (/^[\s+×⋯…?←→↑↓−★☆]+$/.test(button.text)) expect(button.label).toBeTruthy();
        }
        for (const link of await page.getByRole('link').evaluateAll((elements) =>
          elements.map((element) => ({
            tag: element.tagName,
            href: element.getAttribute('href'),
          })),
        )) {
          expect(link.tag).toBe('A');
          expect(link.href).toBeTruthy();
        }
        for (const value of await page
          .getByRole('switch')
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute('aria-checked')),
          ))
          expect(value).toMatch(/^(true|false)$/);
        for (const article of await page
          .getByRole('article')
          .evaluateAll((elements) =>
            elements
              .filter((element) => element.hasAttribute('data-brew-kind'))
              .map((element) => element.getAttribute('data-brew-id')),
          ))
          expect(article).toBeTruthy();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      }
      expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    } finally {
      await f.close();
    }
  });
test('a late Undo acknowledgement does not take focus from a newer draft', async ({ page }) => {
  const f = await newslettersFixture(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  try {
    seedRuleHistory(f, 0);
    await page.goto('/rules');
    await page
      .getByRole('article', { name: 'History rule', exact: true })
      .getByRole('button', { name: 'Copy', exact: true })
      .click();
    await expect(
      page.getByRole('article', { name: 'History rule copy', exact: true }),
    ).toBeVisible();
    await page.route('**/api/actions/*/undo', async (route) => {
      const response = await f.app.inject({
        method: 'POST',
        url: new URL(route.request().url()).pathname,
        payload: {},
      });
      started();
      await held;
      await route.fulfill({ status: response.statusCode, json: response.json() });
    });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await waiting;
    await page.getByLabel('Rule name', { exact: true }).fill('Keep focus here');
    release();
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue('Keep focus here');
    await expect(page.getByLabel('Rule name', { exact: true })).toBeFocused();
  } finally {
    release();
    await f.close();
  }
});
