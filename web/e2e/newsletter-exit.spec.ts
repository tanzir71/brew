import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { newsletterExitFixture } from './newsletter-exit-fixture';

test.use({ viewport: { width: 1440, height: 1100 }, timezoneId: 'UTC' });
const fixtures: Array<Awaited<ReturnType<typeof newsletterExitFixture>>> = [];
test.afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

for (const theme of ['light', 'dark'] as const)
  test(`real MIME letters in a frozen Brew match the Figma letter section in ${theme}`, async ({
    page,
  }) => {
    const fixture = await newsletterExitFixture(page, theme);
    fixtures.push(fixture);
    await page.goto(`/b/1/${fixture.issue.id}`);
    const section = page.getByRole('region', { name: 'From your newsletters', exact: true });
    await expect(section.getByRole('button', { name: 'Open inbox', exact: true })).toBeVisible();
    await expect(section.locator('.brew-letter-card')).toHaveCount(4);
    await expect(section.getByText('3 trackers removed', { exact: true })).toBeVisible();
    await expect(section.getByText('Sponsor block removed', { exact: true })).toBeVisible();
    await expect(section.getByText('5 trackers removed', { exact: true })).toBeVisible();
    await expect(section.getByText('Footer trimmed', { exact: true })).toBeVisible();
    await expect(section.getByText('06:12', { exact: true })).toBeVisible();
    await expect(section.getByText('Yesterday', { exact: true })).toHaveCount(2);
    await expect(
      section.getByText(
        'If an agent can fill your checkout, it shouldn’t have to guess what each field means. A short case for declaring intent in markup.',
        { exact: true },
      ),
    ).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });
    expect(
      await page.locator('.brew-hero-image').evaluate((image) => ({
        width: image.getBoundingClientRect().width,
        height: image.getBoundingClientRect().height,
      })),
    ).toEqual({ width: 680, height: 340 });
    expect(
      await page.locator('.brew-magazine-image').evaluateAll((images) =>
        images.map((image) => ({
          width: image.getBoundingClientRect().width,
          height: image.getBoundingClientRect().height,
        })),
      ),
    ).toEqual(Array.from({ length: 3 }, () => ({ width: 120, height: 84 })));
    const boxes = await section.locator('.brew-letter-card').evaluateAll((cards) =>
      cards.map((card) => {
        const box = card.getBoundingClientRect();
        const style = getComputedStyle(card);
        const avatar = card.querySelector('.brew-avatar')!.getBoundingClientRect();
        return {
          width: box.width,
          height: box.height,
          padding: style.padding,
          border: style.borderLeftWidth,
          radius: style.borderRadius,
          avatar: [avatar.width, avatar.height],
        };
      }),
    );
    expect(boxes).toEqual(
      Array.from({ length: 4 }, (_, index) => ({
        width: 332,
        height: index < 2 ? 193 : 174,
        padding: '18px',
        border: '1px',
        radius: '12px',
        avatar: [24, 24],
      })),
    );
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
        ['serious', 'critical'].includes(item.impact ?? ''),
      ),
    ).toEqual([]);
    await expect(section).toHaveScreenshot(`brew-letters-${theme}.png`, {
      animations: 'disabled',
      threshold: 0,
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(
      page
        .getByRole('navigation', { name: 'Brew contents' })
        .getByRole('link', { name: /^Design & craft/ }),
    ).toHaveAttribute('aria-current', 'location');
    await expect(page).toHaveScreenshot(`brew-with-letters-${theme}.png`, {
      fullPage: true,
      animations: 'disabled',
      threshold: 0,
    });
    await section
      .getByRole('article', { name: fixture.mail[0]!.name, exact: true })
      .getByRole('button', { name: 'Read letter', exact: true })
      .focus();
    await page.keyboard.press('Enter');
    const reader = page.getByRole('dialog', { name: 'Article reader', exact: true });
    await expect(
      reader.getByRole('heading', { name: fixture.mail[0]!.name, exact: true }),
    ).toBeVisible();
    await expect.poll(() => fixture.library.letter(fixture.mail[0]!.id)?.readAt).not.toBeNull();
    await reader.getByRole('button', { name: 'Close article', exact: true }).click();
    const card = section.getByRole('article', { name: fixture.mail[0]!.name, exact: true });
    await expect(card.getByRole('button', { name: 'Read letter', exact: true })).toBeFocused();
    await card.getByRole('button', { name: 'Mark unread', exact: true }).click();
    await expect.poll(() => fixture.library.letter(fixture.mail[0]!.id)?.readAt).toBeNull();
    await card.getByRole('button', { name: 'Star', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Starred', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(fixture.frozenPayload()).toBe(fixture.frozen);
    await section.getByRole('button', { name: 'Open inbox', exact: true }).click();
    await expect(page).toHaveURL('/letters');
    await expect(page.getByRole('button', { name: 'Mark letter read', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/b/1/${fixture.issue.id}`);
    await expect(section.locator('.brew-layout--grid')).toHaveCSS(
      'grid-template-columns',
      /^\d+(?:\.\d+)?px$/,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });

for (const theme of ['light', 'dark'] as const)
  test(`all 20 publisher-shaped MIME templates render clean and inert in Newsletters, originals and a Brew in ${theme}`, async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(90_000); // Twenty complete mail-opening/original-view journeys, not a larger interaction budget.
    const fixture = await newsletterExitFixture(page, theme, true);
    fixtures.push(fixture);
    expect(fixture.mail).toHaveLength(20);
    const remote: string[] = [];
    context.on('request', (request) => {
      const host = new URL(request.url()).hostname;
      if (!['127.0.0.1', 'localhost'].includes(host)) remote.push(request.url());
    });
    await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
    const captures: Array<{ name: string; image: string }> = [];
    for (const item of fixture.mail) {
      await page.goto(`/letters/${item.feedId}/${item.id}`);
      const body = page.locator('.letters-html');
      await expect(body).toContainText('Keep this story.');
      await expect(body).not.toContainText(
        /secretadtoken|Private address|Unsubscribe|Manage your preferences|Hidden preview/,
      );
      expect(
        await body
          .locator('script,style,form,input,iframe,svg,math,[onclick],[onload],[style],[srcset]')
          .count(),
      ).toBe(0);
      const content = await body.innerHTML();
      expect(content).not.toMatch(/utm_|mc_eid|track\/click|ss\/c\/|metrics\.test/);
      expect(
        await body.evaluate((element) =>
          [element, ...element.querySelectorAll('*')].every(
            (node) => getComputedStyle(node).fontStyle === 'normal',
          ),
        ),
      ).toBe(true);
      await body.evaluate(async (element) => {
        await Promise.all([...element.querySelectorAll('img')].map((image) => image.decode()));
      });
      if (item.name === 'publisher hero photo')
        await expect(body.getByRole('img', { name: 'Forest' })).toHaveJSProperty(
          'naturalWidth',
          446,
        );
      if (item.name === 'editorial sponsor mention')
        await expect(body).toContainText('supports public archives');
      const detail = fixture.library.letter(item.id)!;
      expect(detail.cleaning).toEqual({
        trackers: item.expected!.trackers,
        sponsorBlocks: item.expected!.sponsors,
        footerTrimmed: !!item.expected!.footer,
      });
      expect(await page.evaluate(() => 'corpusExecuted' in window)).toBe(false);
      const png = await body.screenshot();
      captures.push({ name: item.name, image: png.toString('base64') });
      await page.getByRole('button', { name: 'Show original', exact: true }).click();
      const original = page.frameLocator('iframe[title^="Original letter from"]');
      await expect(original.locator('body')).toContainText('Keep this story.');
      expect(
        await original
          .locator('script,img,iframe,form,svg,math,[href],[src],[onclick],[onload]')
          .count(),
      ).toBe(0);
    }
    await page.goto(`/b/1/${fixture.issue.id}`);
    await expect(page.locator('.brew-letter-card')).toHaveCount(20);
    const bodies = page.locator('.brew-read-excerpt--full');
    await expect(bodies).toHaveCount(20);
    for (const body of await bodies.all()) {
      await expect(body).toContainText('Keep this story.');
      await expect(body).not.toContainText(
        /secretadtoken|Private address|Unsubscribe|Manage your preferences|Hidden preview/,
      );
      expect(
        await body.locator('script,style,form,iframe,svg,math,[onclick],[onload]').count(),
      ).toBe(0);
    }
    expect(remote).toEqual([]);
    expect(fixture.fetched.every((url) => url === 'https://journal.test/photo.jpg')).toBe(true);
    expect(fixture.frozenPayload()).toBe(fixture.frozen);
    // Review contact sheets contain captures of actual rendered product bodies.
    const gallery = await context.newPage();
    await gallery.setViewportSize({ width: 1000, height: 800 });
    for (let offset = 0; offset < captures.length; offset += 10) {
      await gallery.setContent(
        `<html><body style="margin:0;color-scheme:${theme};background:Canvas;color:CanvasText;font:14px Arial"><main style="display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:16px">${captures
          .slice(offset, offset + 10)
          .map(
            (capture) =>
              `<figure style="margin:0;border:1px solid #ccc;padding:12px"><figcaption>${capture.name}</figcaption><img style="width:100%;height:240px;object-fit:contain;object-position:top left" src="data:image/png;base64,${capture.image}"></figure>`,
          )
          .join('')}</main></body></html>`,
      );
      await gallery
        .locator('img')
        .evaluateAll(async (images) =>
          Promise.all(images.map((image) => (image as HTMLImageElement).decode())),
        );
      await gallery.evaluate(() => window.scrollTo(0, 0));
      await gallery.evaluate(() => new Promise(requestAnimationFrame));
      await expect(gallery).toHaveScreenshot(`newsletter-corpus-${theme}-${offset / 10 + 1}.png`, {
        fullPage: true,
        animations: 'disabled',
      });
      await testInfo.attach(`newsletter-corpus-${offset / 10 + 1}`, {
        body: await gallery.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    }
    await gallery.close();
  });
