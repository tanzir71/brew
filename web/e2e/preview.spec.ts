import { expect, test } from '@playwright/test';
import { composeFixture } from './compose-fixture';
import { BrewService } from '../../targets/node/src/services/brew-service';

test('arbitrary-time previews render the selected local day, retry invalid times and leave the archive untouched', async ({
  page,
}) => {
  const clock = { now: () => new Date('2026-11-25T01:00:00Z') };
  let at = '2026-11-25T01:00:00Z';
  const fixture = await composeFixture(page, 'light', undefined, { clock, previewAt: () => at });
  try {
    const service = new BrewService(fixture.database, clock);
    const issue = await service.generateComposition(fixture.config.id);
    const frozen = fixture.database.sqlite
      .prepare('SELECT payload_json FROM brews WHERE id=?')
      .get(issue.id);
    const changes = fixture.database.sqlite.prepare('SELECT total_changes() AS count').get();
    await page.goto('/b/1/compose?section=design');
    const paper = page.getByRole('article', { name: 'Web preview', exact: true });
    await expect(paper.locator('.compose-paper-date')).toHaveText('Wednesday 25 November · No. 2');
    await expect(paper.locator('[data-preview-section=weekly]')).toHaveCount(0);

    // Friday in the Brew's IANA zone, while the same instant is Thursday in UTC.
    at = '2026-11-26T20:30:00Z';
    await page.reload();
    await expect(paper.locator('.compose-paper-date')).toHaveText('Friday 27 November · No. 2');
    await expect(paper.locator('[data-preview-section=weekly] h2')).toContainText('Weekly review');

    at = '2026-11-27T02:30:00';
    await page.reload();
    await expect(page.getByRole('alert')).toContainText(
      'Choose a valid preview time with Z or a UTC offset.',
    );
    at = '2026-11-27T02:30:00+06:00';
    await page.getByRole('button', { name: 'Retry preview', exact: true }).click();
    await expect(paper.locator('.compose-paper-date')).toHaveText('Friday 27 November · No. 2');
    expect(fixture.puts).toHaveLength(0);
    expect(fixture.database.sqlite.prepare('SELECT total_changes() AS count').get()).toEqual(
      changes,
    );
    expect(service.history(fixture.config.id)).toHaveLength(1);
    expect(service.snapshot(issue.id)).toEqual(issue);
    await page.getByRole('radio', { name: 'Read', exact: true }).click();
    await expect(page.locator('.brew-edition-note p')).toHaveText('One section at a time.');
    expect(
      fixture.database.sqlite.prepare('SELECT payload_json FROM brews WHERE id=?').get(issue.id),
    ).toEqual(frozen);
  } finally {
    await fixture.close();
  }
});
