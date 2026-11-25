import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import PostalMime from 'postal-mime';
import { composeFixture } from './compose-fixture';
import { smtpServer } from '../../targets/node/test/smtp-server';
import { SmtpMail } from '../../targets/node/src/ports/smtp-mail';
import { BrewService } from '../../targets/node/src/services/brew-service';
import { newBrewSection, defaultDelivery } from '../../packages/core/src/composition-model';

test('Schedule test mail and generated issue delivery reach local SMTP and webhook servers', async ({
  page,
}) => {
  const smtp = await smtpServer({ security: 'tls' });
  const mail = new SmtpMail(
    {
      host: '127.0.0.1',
      port: smtp.port,
      security: 'tls',
      from: 'brew@example.test',
      servername: 'localhost',
    },
    { ca: smtp.ca },
  );
  const received: Array<{ body: string; key: string | undefined }> = [];
  const webhook = createServer((req, res) => {
    let body = '';
    req.on('data', (bytes) => {
      body += String(bytes);
    });
    req.on('end', () => {
      received.push({ body, key: req.headers['idempotency-key'] as string | undefined });
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => webhook.listen(0, '127.0.0.1', resolve));
  const clock = { now: () => new Date('2026-11-25T00:00:00Z') };
  const fixture = await composeFixture(page, 'light', globalThis.fetch, {
    clock,
    outboundMail: mail,
    publicUrl: 'http://127.0.0.1:4401',
  });
  try {
    const service = new BrewService(fixture.database, clock);
    const config = service.composition(fixture.config.id)!;
    service.updateComposition(config.id, {
      ...config,
      sections: [
        {
          ...newBrewSection('note', 'note'),
          title: 'Delivery note',
          note: 'Read **slowly**. [Context](/a/7)',
        },
      ],
      delivery: defaultDelivery(),
    });
    const remote: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('http://127.0.0.1:4401/')) remote.push(request.url());
    });
    await page.goto(`/b/${config.id}/compose`);
    await page
      .getByRole('region', { name: 'Schedule summary' })
      .getByRole('button', { name: 'Edit', exact: true })
      .click();
    const sheet = page.getByRole('dialog', { name: 'Schedule & delivery', exact: true });
    await sheet.getByRole('switch', { name: 'Email', exact: true }).check();
    await sheet
      .getByRole('textbox', { name: 'Email recipient', exact: true })
      .fill('reader@example.test');
    await sheet.getByRole('switch', { name: 'Webhook', exact: true }).check();
    const webhookUrl = `http://127.0.0.1:${(webhook.address() as AddressInfo).port}/receive`;
    await sheet.getByRole('textbox', { name: 'Webhook URL', exact: true }).fill(webhookUrl);
    const before = fixture.database.sqlite.prepare('SELECT total_changes() AS n').get();
    await sheet.getByRole('button', { name: 'Send a test now', exact: true }).click();
    await expect(
      sheet.getByRole('status').filter({ hasText: 'Test sent to reader@example.test.' }),
    ).toHaveText('Test sent to reader@example.test.');
    expect(smtp.messages).toHaveLength(1);
    const testMail = await new PostalMime().parse(smtp.messages[0]!);
    expect(testMail.subject).toBe('Test · Morning');
    expect(testMail.text).toContain('Context (http://127.0.0.1:4401/a/7)');
    expect(received).toEqual([]);
    expect(fixture.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    await sheet.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByLabel('Autosave')).toHaveText('All changes saved');
    expect(service.composition(config.id)!.delivery).toMatchObject({
      email: { to: 'reader@example.test' },
      webhook: { url: webhookUrl },
    });
    await page.getByRole('radio', { name: 'Read', exact: true }).click();
    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    await page.getByRole('button', { name: 'Generate now', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Delivery note', exact: true })).toBeVisible();
    expect(smtp.messages).toHaveLength(2);
    expect((await new PostalMime().parse(smtp.messages[1]!)).subject).toBe('Morning · No. 1');
    expect(received).toHaveLength(1);
    const issue = service.history(config.id)[0]!;
    expect(JSON.parse(received[0]!.body)).toMatchObject({ id: issue.id, configName: 'Morning' });
    expect(received[0]!.key).toBe(`http://127.0.0.1:4401/b/${config.id}/${issue.id}`);
    expect(service.deliveryResults(issue.id)).toMatchObject({
      email: { status: 'sent', attempts: 1 },
      webhook: { status: 'sent', attempts: 1, httpStatus: 204 },
    });
    expect(remote).toEqual([]);
  } finally {
    await fixture.close();
    mail.close();
    await smtp.close();
    webhook.closeAllConnections();
    await new Promise<void>((resolve) => webhook.close(() => resolve()));
  }
});
