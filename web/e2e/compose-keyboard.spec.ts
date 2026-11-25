import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { composeFixture } from './compose-fixture';
import { BrewService } from '../../targets/node/src/services/brew-service';

// Reach controls through the actual tab order. No focus(), click(), fill(),
// selectOption() or scripted DOM interaction is used by this journey.
async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  await expect(target).toBeEnabled();
  for (let step = 0; step < 150; step++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(
    `Could not reach ${(await target.getAttribute('aria-label')) ?? (await target.textContent())} by Tab.`,
  );
}
async function activate(page: Page, target: Locator) {
  await tabTo(page, target);
  await page.keyboard.press('Enter');
}
async function typeInto(page: Page, target: Locator, value: string) {
  await tabTo(page, target);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(value);
}
async function toggle(page: Page, target: Locator) {
  await tabTo(page, target);
  await page.keyboard.press('Space');
}
async function addSection(page: Page, kind: string, title: string) {
  await activate(page, page.getByRole('button', { name: 'Add section', exact: true }));
  const sheet = page.getByRole('dialog', { name: 'Add section', exact: true });
  await activate(page, sheet.getByRole('button', { name: kind, exact: true }));
  await expect(sheet).not.toBeVisible();
  const input = page.getByRole('textbox', { name: 'Section title', exact: true });
  await expect(input).toBeFocused();
  await typeInto(page, input, title);
  return page.getByRole('region', { name: title, exact: true });
}
async function replaceToday(
  page: Page,
  card: Locator,
  library: 'Feeds' | 'Folders',
  names: string[],
) {
  await activate(page, card.getByRole('button', { name: '+ Source', exact: true }));
  const sheet = page.getByRole('dialog', { name: /^Add a source to/ });
  await expect(sheet.getByRole('textbox', { name: 'URL or search', exact: true })).toBeFocused();
  await tabTo(page, sheet.getByRole('radio', { name: 'Feeds', exact: true }));
  await page.keyboard.press('End');
  await toggle(page, sheet.getByRole('checkbox', { name: 'Today', exact: true }));
  await tabTo(page, sheet.getByRole('radio', { name: 'Starred', exact: true }));
  await page.keyboard.press('Home');
  if (library === 'Folders') await page.keyboard.press('ArrowRight');
  for (const name of names) await toggle(page, sheet.getByRole('checkbox', { name, exact: true }));
  await activate(
    page,
    sheet.getByRole('button', {
      name: `Add ${names.length} ${names.length === 1 ? 'source' : 'sources'}`,
      exact: true,
    }),
  );
  await expect(sheet).not.toBeVisible();
}

test('composes, saves and generates a four-section Brew using only the keyboard', async ({
  page,
}) => {
  // A full creation journey has many Tab/key steps; individual performance
  // budgets continue to be checked by the existing performance suite.
  test.setTimeout(90_000);
  const clock = { now: () => new Date('2026-11-25T01:00:00Z') };
  const fixture = await composeFixture(page, 'light', undefined, { clock });
  try {
    const service = new BrewService(fixture.database, clock);
    expect(service.composition(2)!.sections).toEqual([]);
    await page.addInitScript(() => {
      const inputs: string[] = [];
      Object.defineProperty(window, '__m9PointerInputs', { value: inputs });
      for (const type of ['pointerdown', 'mousedown', 'click'])
        document.addEventListener(
          type,
          (event) => {
            if (type !== 'click' || (event as MouseEvent).detail > 0) inputs.push(type);
          },
          true,
        );
    });
    await page.goto('/b/2/compose');
    await expect(page.getByRole('article', { name: 'Web preview', exact: true })).toBeVisible();
    await activate(page, page.getByRole('button', { name: 'Brew options', exact: true }));
    await typeInto(
      page,
      page.getByRole('textbox', { name: 'Brew name', exact: true }),
      'Keyboard edition',
    );
    await page.keyboard.press('Escape');

    const lead = await addSection(page, 'Items', 'Design lead');
    await replaceToday(page, lead, 'Folders', ['Design', 'Independent']);
    await tabTo(page, lead.getByRole('radio', { name: 'Magazine', exact: true }));
    await page.keyboard.press('Home');
    await expect(lead.getByRole('radio', { name: 'Lead', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await typeInto(page, lead.getByRole('spinbutton', { name: 'Items at most', exact: true }), '2');
    await tabTo(page, lead.getByRole('radio', { name: 'Excerpt', exact: true }));
    await page.keyboard.press('End');
    await expect(lead.getByRole('radio', { name: 'Full text', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await toggle(page, lead.getByRole('switch', { name: 'Images', exact: true }));
    await toggle(page, lead.getByRole('switch', { name: 'Unread only', exact: true }));
    await tabTo(page, lead.getByRole('combobox', { name: 'Section order', exact: true }));
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await activate(page, lead.getByRole('button', { name: '+ Condition', exact: true }));
    await typeInto(
      page,
      lead.getByRole('textbox', { name: 'Condition 1 value', exact: true }),
      'figma',
    );
    await expect(lead.getByText('Matches 1 of 4 now', { exact: true })).toBeVisible();
    await activate(page, lead.getByRole('button', { name: 'Section options', exact: true }));
    const options = page.getByRole('dialog', { name: 'Options · Design lead', exact: true });
    await toggle(page, options.getByRole('button', { name: 'Wed', exact: true }));
    await page.keyboard.press('Escape');

    const engineering = await addSection(page, 'Items', 'Engineering grid');
    await replaceToday(page, engineering, 'Feeds', ['The Platform Desk']);
    await tabTo(page, engineering.getByRole('radio', { name: 'Magazine', exact: true }));
    await page.keyboard.press('ArrowRight');
    await expect(engineering.getByRole('radio', { name: 'Grid', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await typeInto(
      page,
      engineering.getByRole('spinbutton', { name: 'Items at most', exact: true }),
      '1',
    );
    await tabTo(page, engineering.getByRole('radio', { name: 'Excerpt', exact: true }));
    await page.keyboard.press('Home');

    const headlines = await addSection(page, 'Items', 'Today headlines');
    await tabTo(page, headlines.getByRole('radio', { name: 'Magazine', exact: true }));
    await page.keyboard.press('End');
    await expect(headlines.getByRole('radio', { name: 'Headlines', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await typeInto(
      page,
      headlines.getByRole('spinbutton', { name: 'Items at most', exact: true }),
      '3',
    );
    await tabTo(page, headlines.getByRole('radio', { name: 'Excerpt', exact: true }));
    await page.keyboard.press('Home');

    const note = await addSection(page, 'Note', "Editor's note");
    const markdown = note.getByRole('textbox', { name: 'Note · Markdown', exact: true });
    await typeInto(page, markdown, 'Read **slowly**. [Details](https://example.test/note)');
    await page.keyboard.press('Alt+ArrowUp');
    await expect(markdown).toBeFocused();
    await activate(page, note.getByRole('button', { name: "Move Editor's note up", exact: true }));
    await expect(
      page
        .getByRole('region')
        .filter({ has: page.getByRole('textbox', { name: 'Section title', exact: true }) }),
    ).toHaveAttribute('aria-label', "Editor's note");

    const previewFormat = page.getByRole('radiogroup', { name: 'Preview format', exact: true });
    await tabTo(page, previewFormat.getByRole('radio', { name: 'Web', exact: true }));
    await page.keyboard.press('ArrowRight');
    await expect(page.frameLocator('iframe[title="Email preview"]').locator('strong')).toHaveText(
      'slowly',
    );
    await page.keyboard.press('ArrowRight');
    await expect(page.getByLabel('Atom feed preview')).toContainText('Design lead');
    const feedTitles = await page.getByLabel('Atom feed preview').evaluate((element) => {
      const xml = new DOMParser().parseFromString(element.textContent ?? '', 'application/xml');
      if (xml.querySelector('parsererror')) throw new Error('Invalid Atom preview XML.');
      const content = xml.getElementsByTagNameNS('http://www.w3.org/2005/Atom', 'content')[0]
        ?.textContent;
      if (!content) throw new Error('The Atom preview has no issue content.');
      return [...new DOMParser().parseFromString(content, 'text/html').querySelectorAll('h2')].map(
        (heading) => heading.textContent,
      );
    });
    expect(feedTitles).toEqual([
      'Design lead',
      "Editor's note",
      'Engineering grid',
      'Today headlines',
    ]);
    await page.keyboard.press('Home');
    await tabTo(page, page.getByRole('radio', { name: 'Desktop', exact: true }));
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('article', { name: 'Web preview', exact: true })).toHaveAttribute(
      'data-device',
      'phone',
    );
    await page.keyboard.press('ArrowLeft');

    await activate(
      page,
      page
        .getByRole('region', { name: 'Schedule summary', exact: true })
        .getByRole('button', { name: 'Edit', exact: true }),
    );
    const schedule = page.getByRole('dialog', { name: 'Schedule & delivery', exact: true });
    await expect(schedule.getByRole('radio', { name: 'Weekdays', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    for (const day of ['Monday', 'Tuesday', 'Thursday', 'Friday'])
      await toggle(page, schedule.getByRole('button', { name: day, exact: true }));
    await tabTo(page, schedule.getByRole('combobox', { name: 'Time', exact: true }));
    await page.keyboard.press('End');
    await tabTo(page, schedule.getByRole('combobox', { name: 'Time zone', exact: true }));
    await page.keyboard.press('End');
    await toggle(page, schedule.getByRole('switch', { name: 'Skip small issues', exact: true }));
    await activate(page, schedule.getByRole('button', { name: 'Save', exact: true }));
    await expect(schedule).not.toBeVisible();
    await expect(page.getByLabel('Autosave')).toHaveText('All changes saved');

    const saved = service.composition(2)!;
    expect(saved).toMatchObject({
      name: 'Keyboard edition',
      timezone: 'UTC',
      schedule: { kind: 'weekly', days: [3], time: '23:59', skipIfFewerThan: 0 },
    });
    expect(saved.sections.map((section) => section.title)).toEqual([
      'Design lead',
      "Editor's note",
      'Engineering grid',
      'Today headlines',
    ]);
    expect(saved.sections[0]).toMatchObject({
      layout: 'lead',
      depth: 'full',
      maxItems: 2,
      images: false,
      onlyUnread: false,
      sort: 'oldest',
      days: [3],
      sources: [
        { kind: 'folder', id: 1 },
        { kind: 'folder', id: 2 },
      ],
      filter: {
        match: 'all',
        conditions: [{ field: 'title', operator: 'contains', value: 'figma' }],
      },
    });
    expect(saved.sections[1]).toMatchObject({
      kind: 'note',
      note: 'Read **slowly**. [Details](https://example.test/note)',
    });
    expect(saved.sections[2]).toMatchObject({
      layout: 'grid',
      depth: 'title',
      maxItems: 1,
      sources: [{ kind: 'feed', id: 4 }],
    });
    expect(saved.sections[3]).toMatchObject({
      layout: 'headlines',
      depth: 'title',
      maxItems: 3,
      sources: [{ kind: 'today' }],
    });
    expect(service.history(2)).toEqual([]);
    await activate(page, page.getByRole('button', { name: 'Make one now', exact: true }));
    await expect(page).toHaveURL(/\/b\/2\/1$/);
    await expect(
      page.getByRole('heading', { name: 'Keyboard edition', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.brew-edition-note strong')).toHaveText('slowly');
    const issue = service.snapshot(1)!;
    expect(issue.sections.map((section) => section.title)).toEqual(
      saved.sections.map((section) => section.title),
    );
    expect(issue.sections[0]!.items.map((item) => item.title)).toEqual([
      'Figma’s variables panel, a month in',
    ]);
    expect(issue.sections[2]!.items.map((item) => item.title)).toEqual([
      'SQLite in the browser is finally boring',
    ]);
    expect(issue.sections[3]!.items).toHaveLength(3);
    expect(service.history(2)).toHaveLength(1);
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
        ['serious', 'critical'].includes(item.impact ?? ''),
      ),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => (window as unknown as { __m9PointerInputs: string[] }).__m9PointerInputs,
      ),
    ).toEqual([]);
  } finally {
    await fixture.close();
  }
});
