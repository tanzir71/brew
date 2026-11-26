import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import { newslettersFixture } from './newsletters-fixture';
import { composeFixture } from './compose-fixture';
import { RulesService } from '../../targets/node/src/services/rules-service';
import { newBrewSection } from '../../packages/core/src/composition-model';

async function undersized(page: Page) {
  return page.evaluate(async () => {
    await document.fonts.ready;
    const modal = [...document.querySelectorAll<HTMLDialogElement>('dialog:modal')].at(-1);
    return [
      ...(modal ?? document).querySelectorAll<HTMLElement>(
        'button,a[href],input:not([type="hidden"]),select,textarea,[role="switch"],[role="radio"]',
      ),
    ].flatMap((node) => {
      if (node.closest('[aria-hidden="true"],[inert]')) return [];
      const rect = node.getBoundingClientRect();
      if (
        !rect.width ||
        !rect.height ||
        !node.getClientRects().length ||
        getComputedStyle(node).visibility !== 'visible'
      )
        return [];
      // Publisher links remain part of reading content, rather than application controls.
      if (
        node.matches('a') &&
        node.closest('.article-content,.letters-html,.brew-read-excerpt,.compose-note-preview')
      )
        return [];
      const labels = 'labels' in node ? [...((node as HTMLInputElement).labels ?? [])] : [];
      const adequateLabel = labels.some((label) => {
        const box = label.getBoundingClientRect();
        return box.width >= 24 && box.height >= 24;
      });
      if ((rect.width >= 24 && rect.height >= 24) || adequateLabel) return [];
      return [
        {
          tag: node.tagName.toLowerCase(),
          name:
            node.getAttribute('aria-label') ||
            node.textContent?.trim().slice(0, 60) ||
            labels[0]?.textContent?.trim() ||
            '',
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
          className: node.className,
        },
      ];
    });
  });
}

test('core native controls expose at least 24px activation targets', async ({ page }, testInfo) => {
  const f = await newslettersFixture(page);
  const views: Record<string, Awaited<ReturnType<typeof undersized>>> = {};
  const inspect = async (name: string) => {
    views[name] = await undersized(page);
  };
  try {
    const folder = f.database.sqlite
      .prepare("SELECT id FROM folders WHERE title='Design'")
      .get() as { id: number };
    f.brews.updateComposition(f.morning.id, {
      ...f.morning,
      sections: [
        { ...newBrewSection('target-audit'), sources: [{ kind: 'folder', id: folder.id }] },
      ],
    });
    await f.brews.generateComposition(f.morning.id);
    new RulesService(f.database).create({
      name: 'Target audit rule',
      enabled: false,
      matchType: 'all',
      scope: {},
      conditions: [{ field: 'title', operator: 'contains', value: 'Design' }],
      actions: [{ type: 'star' }],
      stopProcessing: false,
    });
    await page.goto('/test/components.html');
    await expect(page.getByRole('switch', { name: 'On toggle', exact: true })).toBeVisible();
    await inspect('primitives');
    await page.goto('/test/components.html?view=composites');
    await page.getByRole('button', { name: 'Open side sheet', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Schedule & delivery', exact: true }),
    ).toBeVisible();
    await inspect('shared sheet');
    await page.goto('/all?agent=1&density=title');
    await expect(
      page.getByRole('button', { name: 'Open article · Design story', exact: true }),
    ).toBeVisible();
    await inspect('reader');
    await page.getByRole('button', { name: 'Open article · Design story', exact: true }).click();
    await expect(
      page
        .getByRole('dialog', { name: 'Article reader', exact: true })
        .getByRole('button', { name: 'Tag', exact: true }),
    ).toBeVisible();
    await inspect('article');
    await page.goto('/rules');
    await expect(
      page.getByRole('article', { name: 'Target audit rule', exact: true }),
    ).toBeVisible();
    await inspect('rules');
    await page.goto('/feeds');
    await expect(page.getByRole('article', { name: 'Design journal', exact: true })).toBeVisible();
    await inspect('feeds');
    await page.goto('/letters');
    await expect(
      page.getByRole('article', { name: 'Letter from Interface Letters', exact: true }),
    ).toBeVisible();
    await inspect('newsletters');
    await page.goto('/settings/runs');
    await expect(page.getByRole('heading', { name: 'Where Brew runs', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Current mode', exact: true })).toContainText(
      'Node',
    );
    await inspect('settings');
    await page.getByRole('link', { name: 'Reading', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Reading settings', exact: true })).toBeVisible();
    await inspect('reading settings');
    await page.goto(`/b/${f.morning.id}`);
    await expect(page.getByRole('button', { name: 'Design story', exact: true })).toBeVisible();
    await inspect('read edition');
    await fs.writeFile(testInfo.outputPath('control-targets.json'), JSON.stringify(views, null, 2));
    expect(
      Object.fromEntries(
        Object.entries(views).map(([name, values]) => [
          name,
          [
            ...new Map(
              values.map((value) => [`${value.tag}:${value.name}:${value.className}`, value]),
            ).values(),
          ],
        ]),
      ),
    ).toEqual(Object.fromEntries(Object.keys(views).map((name) => [name, []])));
  } finally {
    await f.close();
  }
});

test('Compose, source and delivery controls expose at least 24px activation targets', async ({
  page,
}, testInfo) => {
  const f = await composeFixture(page);
  const views: Record<string, Awaited<ReturnType<typeof undersized>>> = {};
  try {
    await page.goto(`/b/${f.config.id}/compose`);
    await expect(
      page.getByRole('textbox', { name: 'Section title', exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Configure Briefs', exact: true })).toBeVisible();
    views.compose = await undersized(page);
    await page.getByRole('button', { name: '+ Source', exact: true }).first().click();
    await expect(
      page.getByRole('dialog', { name: 'Add a source to “Design & craft”', exact: true }),
    ).toBeVisible();
    views.sources = await undersized(page);
    await page.keyboard.press('Escape');
    await page
      .getByRole('region', { name: 'Schedule summary', exact: true })
      .getByRole('button', { name: 'Edit', exact: true })
      .click();
    await expect(
      page.getByRole('dialog', { name: 'Schedule & delivery', exact: true }),
    ).toBeVisible();
    views.schedule = await undersized(page);
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: 'Configure Briefs', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Briefs (AI summaries)', exact: true }),
    ).toBeVisible();
    views['Briefs setup'] = await undersized(page);
    await fs.writeFile(testInfo.outputPath('control-targets.json'), JSON.stringify(views, null, 2));
    expect(views).toEqual({ compose: [], sources: [], schedule: [], 'Briefs setup': [] });
  } finally {
    await f.close();
  }
});

for (const theme of ['light', 'dark']) {
  test(`switch and checkbox edges activate the native control without changing neighbouring values in ${theme}`, async ({
    page,
  }) => {
    await page.goto(`/test/components.html?theme=${theme}`);
    const toggle = page.getByRole('switch', { name: 'On toggle', exact: true });
    const other = page.getByRole('switch', { name: 'Off toggle', exact: true });
    await expect(toggle).toBeChecked();
    const box = (await toggle.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
    await page.mouse.click(box.x + box.width / 2, box.y + 1);
    await expect(toggle).not.toBeChecked();
    await expect(other).not.toBeChecked();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 1);
    await expect(toggle).toBeChecked();
    const checkbox = page.getByRole('checkbox', { name: 'Unchecked checkbox', exact: true });
    const check = (await checkbox.boundingBox())!;
    expect(check.width).toBeGreaterThanOrEqual(24);
    expect(check.height).toBeGreaterThanOrEqual(24);
    await page.mouse.click(check.x + 1, check.y + 1);
    await expect(checkbox).toBeChecked();
    await expect(
      page.getByRole('checkbox', { name: 'Checked checkbox', exact: true }),
    ).toBeChecked();
    await page.mouse.click(check.x + check.width - 1, check.y + check.height - 1);
    await expect(checkbox).not.toBeChecked();
    await checkbox.focus();
    await page.keyboard.press('Space');
    await expect(checkbox).toBeChecked();
  });
}
