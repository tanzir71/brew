import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { log } from 'node:console';
import { tmpdir } from 'node:os';
import { URL } from 'node:url';
import process from 'node:process';
import { createApp } from '../dist/targets/node/src/app.js';
import { openDatabase } from '../dist/targets/node/src/db/database.js';
import { NewsletterService } from '../dist/targets/node/src/services/newsletter-service.js';
import { newBrewSection, sectionWithSources } from '../dist/packages/core/src/composition-model.js';
import { smtpConfigFromEnv } from '../dist/targets/node/src/outbound-config.js';
import { renderBrewJson, renderBrewMarkdown } from '../dist/packages/core/src/brew-outputs.js';
import { inboundConfigFromEnv } from '../dist/targets/node/src/inbound-config.js';

// A built install must find migrations and the SPA outside the repository cwd.
const previousDirectory = process.cwd();
process.chdir(tmpdir());
let app;
try {
  const database = openDatabase(':memory:');
  app = await createApp({ database, serveWeb: true });
  const health = await app.inject('/api/health');
  assert.deepEqual(health.json(), { ok: true });
  const capabilities = await app.inject('/api/capabilities');
  assert.equal(capabilities.statusCode, 200);
  assert.equal(capabilities.json().mode, 'node');
  assert.equal(capabilities.headers['cache-control'], 'no-store');
  const page = await app.inject('/');
  assert.equal(page.statusCode, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  const script = page.body.match(/src="([^"]+\.js)"/)[1];
  assert.equal((await app.inject(script)).statusCode, 200);
  const route = await app.inject('/reader');
  assert.equal(route.body, page.body);
  assert.equal((await app.inject('/settings/runs')).body, page.body);
  assert.equal((await app.inject('/b/1/compose')).body, page.body);
  assert.equal((await app.inject('/letters')).body, page.body);
  assert.equal((await app.inject('/letters/1')).body, page.body);
  const fonts = ['instrument-sans', 'newsreader', 'geist-mono'].flatMap((name) =>
    ['latin', 'latin-ext'].map((subset) => `/fonts/${name}-${subset}.woff2`),
  );
  for (const asset of [
    ...fonts,
    '/figma/runs/7b5f9.svg',
    '/figma/icons/brew.svg',
    '/figma/components/82232.svg',
    '/figma/components/872aa.svg',
    '/figma/components/291ba.svg',
    '/figma/components/fb52b.svg',
    '/figma/compose/lead.svg',
    '/figma/compose/variables.svg',
    '/figma/compose/lines.png',
    '/figma/newsletters/letter.png',
  ]) {
    const response = await app.inject(asset);
    assert.equal(response.statusCode, 200);
    assert.ok(response.rawPayload.byteLength > 0);
    if (asset.endsWith('.woff2')) {
      assert.equal(response.rawPayload.subarray(0, 4).toString(), 'wOF2');
      assert.match(response.headers['content-type'], /font\/woff2/);
    }
  }
  const composed = await app.inject({
    method: 'POST',
    url: '/api/brew-configs/composition',
    payload: {
      name: 'Build check',
      enabled: true,
      timezone: 'Asia/Dhaka',
      schedule: { kind: 'daily', time: '07:00' },
      delivery: { web: true, feed: false, publicCopy: false },
      sections: [],
    },
  });
  assert.equal(composed.statusCode, 201);
  const preview = await app.inject({
    method: 'POST',
    url: `/api/brew-configs/${composed.json().id}/preview`,
    payload: { draft: composed.json(), at: '2026-11-25T01:00:00Z' },
  });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.json().snapshot.version, 2);
  assert.match(preview.json().outputs.feed, /<feed xmlns=/);
  assert.equal(JSON.parse(preview.json().outputs.json).version, 2);
  assert.match(preview.json().outputs.markdown, /^# Build check/m);
  assert.equal(
    JSON.parse(preview.json().outputs.jsonFeed).version,
    'https://jsonfeed.org/version/1.1',
  );
  assert.match(preview.json().outputs.email, /width="600"/);
  assert.match(preview.json().outputs.text, /No\. 1/);
  const savedPreview = await app.inject({
    method: 'POST',
    url: `/api/brew-configs/${composed.json().id}/preview`,
    payload: { at: '2026-11-25T07:00:00+06:00' },
  });
  assert.equal(savedPreview.statusCode, 200);
  assert.equal(savedPreview.headers['cache-control'], 'no-store');
  assert.deepEqual(savedPreview.json(), preview.json());
  assert.deepEqual(
    (await app.inject(`/api/brew-configs/${composed.json().id}/history`)).json(),
    [],
  );
  const ambiguousPreview = await app.inject({
    method: 'POST',
    url: `/api/brew-configs/${composed.json().id}/preview`,
    payload: { at: '2026-11-25T07:00:00' },
  });
  assert.equal(ambiguousPreview.statusCode, 422);
  assert.equal(ambiguousPreview.headers['cache-control'], 'no-store');
  const schedule = await app.inject({
    method: 'POST',
    url: `/api/brew-configs/${composed.json().id}/schedule-preview`,
    payload: {
      schedule: { kind: 'weekly', time: '08:17', days: [0] },
      timezone: 'Europe/Paris',
      enabled: true,
    },
  });
  assert.equal(schedule.statusCode, 200);
  assert.equal(schedule.headers['cache-control'], 'no-store');
  assert.ok(Date.parse(schedule.json().nextAt) > Date.parse(schedule.json().now));
  assert.deepEqual(capabilities.json().outputs, { twins: true, feed: true, webhook: true });
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/brew-configs/${composed.json().id}/test-email`,
        payload: { draft: composed.json() },
      })
    ).statusCode,
    501,
  );
  assert.deepEqual((await app.inject('/api/sources/mailbox')).json(), { address: null });
  const sourceSearch = await app.inject({
    method: 'POST',
    url: '/api/sources/searches',
    payload: { clientId: 'build-search', name: 'Build search', query: 'figma' },
  });
  assert.equal(sourceSearch.statusCode, 200);
  assert.deepEqual((await app.inject('/api/sources/searches')).json(), [sourceSearch.json()]);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/sources/discover',
        payload: { url: 'javascript:alert(1)' },
      })
    ).statusCode,
    400,
  );
  assert.equal((await app.inject('/api/missing')).statusCode, 404);
  const newsletters = new NewsletterService(database);
  const letter = await newsletters.ingest(
    `From: Notes <notes@journal.test>\r\nSubject: Compiled letter\r\nMessage-ID: <build@journal.test>\r\nContent-Type: text/html\r\n\r\n<p>A compiled story.</p><img width="1" src="https://metrics.test/open"><script>evil()</script>`,
  );
  assert.equal(letter.outcome, 'inserted');
  const article = (await app.inject(`/api/articles/${letter.articleId}`)).json();
  assert.equal(article.contentHtml, '<p>A compiled story.</p>');
  assert.equal(article.url, `/a/${letter.articleId}`);
  assert.equal(article.rawHtml, undefined);
  const articleTwin = await app.inject(`/a/${letter.articleId}.json`);
  assert.equal(articleTwin.statusCode, 200);
  assert.equal(articleTwin.json().id, letter.articleId);
  assert.equal(articleTwin.json().contentHtml, '<p>A compiled story.</p>');
  assert.match(articleTwin.headers['cache-control'], /private, no-store/);
  assert.equal((await app.inject({ method: 'HEAD', url: `/a/${letter.articleId}.md` })).body, '');
  assert.match((await app.inject(`/a/${letter.articleId}`)).body, /id="root"/);
  const readerTwin = await app.inject(`/feed/${letter.feedId}.json?density=title`);
  assert.equal(readerTwin.statusCode, 200);
  assert.equal(readerTwin.json().total, 1);
  assert.equal(readerTwin.json().items[0].id, letter.articleId);
  assert.match(readerTwin.headers['cache-control'], /private, no-store/);
  assert.match((await app.inject('/search.md?q=Compiled')).body, /Compiled letter/);
  assert.match((await app.inject('/all')).body, /id="root"/);
  assert.equal((await app.inject({ method: 'HEAD', url: '/all.md' })).body, '');
  const savedCompose = await app.inject(`/b/${composed.json().id}/compose.json`);
  assert.equal(savedCompose.statusCode, 200);
  assert.equal(savedCompose.json().kind, 'compose');
  assert.equal(savedCompose.json().state.brewId, composed.json().id);
  assert.equal((await app.inject('/settings/runs.json?setup=agents')).json().kind, 'settings');
  assert.equal((await app.inject('/letters.json')).json().kind, 'newsletters');
  assert.equal(
    (await app.inject(`/letters/${letter.feedId}.json`)).json().state.senderId,
    letter.feedId,
  );
  assert.equal(
    (await app.inject(`/letters/${letter.feedId}/${letter.articleId}.json`)).json().id,
    letter.articleId,
  );
  assert.equal((await app.inject(`/letters/999999/${letter.articleId}.json`)).statusCode, 404);
  assert.match(
    (await app.inject(`/letters/${letter.feedId}/${letter.articleId}`)).body,
    /id="root"/,
  );
  assert.equal((await app.inject('/rules.json')).json().kind, 'rules');
  assert.equal((await app.inject('/feeds.json?section=hidden')).json().kind, 'hidden-articles');
  assert.equal((await app.inject('/feeds.json?section=hidden&page=2')).json().state.page, 2);
  assert.equal(
    (await app.inject('/api/articles-hidden?includeTotal=true&page=2')).json().pageSize,
    50,
  );
  assert.equal((await app.inject('/api/articles-hidden?includeTotal=true&page=0')).statusCode, 400);
  assert.match((await app.inject('/reader.md')).body, /A calmer way/);
  for (const path of ['/rules', '/rules/1', '/feeds?section=health', '/reader', '/settings/runs'])
    assert.match((await app.inject(path)).body, /id="root"/);
  const letterDetail = (await app.inject(`/api/newsletters/letters/${letter.articleId}`)).json();
  assert.equal(letterDetail.originalAvailable, true);
  assert.equal(letterDetail.cleaning.trackers, 1);
  assert.equal(letterDetail.rawHtml, undefined);
  assert.equal((await app.inject('/api/newsletters/overview')).json().unreadCount, 1);
  const senderSettings = await app.inject({
    method: 'PATCH',
    url: `/api/newsletters/senders/${letter.feedId}`,
    payload: { favorite: true, retentionDays: 60 },
  });
  assert.equal(senderSettings.statusCode, 200);
  assert.equal(senderSettings.json().settings.favorite, true);
  assert.equal((await app.inject('/api/newsletters/letters?view=favorites')).json().total, 1);
  const original = await app.inject(`/api/newsletters/letters/${letter.articleId}/original`);
  assert.equal(original.statusCode, 200);
  assert.equal(original.headers['cache-control'], 'no-store');
  assert.match(original.headers['content-security-policy'], /^sandbox; default-src 'none'/);
  assert.match(original.body, /A compiled story/);
  assert.doesNotMatch(original.body, /<script|<img|metrics\.test/);
  const newsletterSection = sectionWithSources(newBrewSection('letters'), [
    { kind: 'newsletters', senderIds: [letter.feedId] },
  ]);
  const newsletterComposition = await app.inject({
    method: 'PUT',
    url: `/api/brew-configs/${composed.json().id}/composition`,
    payload: { ...composed.json(), sections: [newsletterSection] },
  });
  assert.equal(newsletterComposition.statusCode, 200);
  assert.equal(newsletterComposition.json().sections[0].layout, 'grid');
  const newsletterPreview = await app.inject({
    method: 'POST',
    url: `/api/brew-configs/${composed.json().id}/preview`,
    payload: { at: new Date().toISOString() },
  });
  assert.equal(newsletterPreview.statusCode, 200);
  assert.equal(
    newsletterPreview.json().snapshot.sections[0].items[0].newsletter.cleaning.trackers,
    1,
  );
  assert.match(
    newsletterPreview.json().snapshot.sections[0].items[0].summaryHtml,
    /A compiled story/,
  );
  assert.deepEqual(
    newsletterPreview.json().snapshot.sections[0].items.map((item) => item.id),
    [letter.articleId],
  );
  assert.equal(
    database.sqlite
      .prepare('SELECT raw_html FROM articles WHERE id=?')
      .get(letter.articleId)
      .raw_html.includes('<script>'),
    true,
  );
  assert.equal(capabilities.json().inboundMail, null);
  const inbound = inboundConfigFromEnv({
    BREW_INBOUND_MODE: 'mailgun',
    BREW_INBOUND_ADDRESS: 'letters@in.example.test',
    BREW_MAILGUN_SIGNING_KEY: 'build-test-signing-key',
  });
  const inboundDatabase = openDatabase(':memory:');
  const inboundApp = await createApp({ database: inboundDatabase, inbound });
  try {
    assert.equal((await inboundApp.inject('/api/capabilities')).json().inboundMail, 'webhook');
    assert.deepEqual((await inboundApp.inject('/api/sources/mailbox')).json(), {
      address: 'letters@in.example.test',
    });
    const payload =
      JSON.stringify(
        {
          from: 'Build Notes <build@journal.test>',
          recipient: 'letters@in.example.test',
          subject: 'Webhook build',
          'body-html': '<p>Webhook story.</p><img width="1" src="https://metrics.test/open">',
          'message-headers': [['Message-ID', '<compiled-webhook@journal.test>']],
        },
        null,
        2,
      ) + '\n';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const request = {
      method: 'POST',
      url: '/api/inbound/email/json',
      payload,
      headers: {
        'content-type': 'application/json',
        'x-mailgun-timestamp': timestamp,
        'x-mailgun-signature': createHmac('sha256', 'build-test-signing-key')
          .update(timestamp)
          .update(payload)
          .digest('hex'),
      },
    };
    const received = await inboundApp.inject(request);
    assert.equal(received.statusCode, 200);
    assert.deepEqual((await inboundApp.inject(request)).json(), received.json());
    assert.equal(
      (await inboundApp.inject(`/api/articles/${received.json().articleId}`)).json().contentHtml,
      '<p>Webhook story.</p>',
    );
    assert.deepEqual(inboundDatabase.sqlite.prepare('SELECT count(*) AS n FROM articles').get(), {
      n: 1,
    });
    assert.equal(
      (await inboundApp.inject({ ...request, headers: { 'content-type': 'application/json' } }))
        .statusCode,
      401,
    );
  } finally {
    await inboundApp.close();
  }
  const configId = composed.json().id;
  const generatedOutput = await app.inject({
    method: 'POST',
    url: `/api/brew-configs/${configId}/generate`,
  });
  assert.equal(generatedOutput.statusCode, 200);
  const outputIssue = generatedOutput.json();
  const outputCache = database.sqlite
    .prepare('SELECT rendered_md,rendered_json FROM brews WHERE id=?')
    .get(outputIssue.id);
  assert.equal(outputCache.rendered_md, renderBrewMarkdown(outputIssue));
  assert.equal(outputCache.rendered_json, renderBrewJson(outputIssue));
  const outputPath = `/b/${configId}/${outputIssue.id}`;
  const markdownOutput = await app.inject(`${outputPath}.md`);
  assert.equal(markdownOutput.statusCode, 200);
  assert.match(markdownOutput.headers['content-type'], /text\/markdown/);
  assert.match(markdownOutput.headers['cache-control'], /private/);
  assert.equal((await app.inject(`${outputPath}.json`)).json().id, outputIssue.id);
  assert.equal((await app.inject(`${outputPath}999.json`)).statusCode, 404);
  assert.equal((await app.inject(`/b/${configId}.atom`)).statusCode, 404);
  const outputConfig = (await app.inject(`/api/brew-configs/${configId}/composition`)).json();
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/brew-configs/${configId}/composition`,
        payload: { ...outputConfig, delivery: { ...outputConfig.delivery, feed: true } },
      })
    ).statusCode,
    200,
  );
  const compiledAtom = await app.inject(`/b/${configId}.atom`);
  assert.equal(compiledAtom.statusCode, 200);
  assert.match(compiledAtom.headers['content-type'], /application\/atom\+xml/);
  const compiledFeed = (await app.inject(`/b/${configId}.json`)).json();
  assert.equal(compiledFeed.items[0].url, `http://localhost${outputPath}`);
  assert.equal((await app.inject({ method: 'HEAD', url: `${outputPath}.md` })).body, '');
  const smtpConfig = smtpConfigFromEnv({
    BREW_SMTP_HOST: 'smtp.example.test',
    BREW_SMTP_FROM: 'brew@example.test',
  });
  const smtpApp = await createApp({
    database: openDatabase(':memory:'),
    publicUrl: 'https://compiled.example.test',
    smtp: smtpConfig,
  });
  try {
    assert.equal((await smtpApp.inject('/api/capabilities')).json().emailDelivery, 'smtp');
  } finally {
    await smtpApp.close();
  }
  const senderBefore = database.sqlite.prepare('SELECT * FROM feeds WHERE id=?').get(letter.feedId);
  const senderBrewsBefore = database.sqlite.prepare('SELECT * FROM brew_configs ORDER BY id').all();
  const senderChangesBefore = database.sqlite.prepare('SELECT total_changes() AS n').get();
  const senderPatch = { blocked: true, skipInbox: true };
  const senderPreview = await app.inject({
    method: 'POST',
    url: `/api/newsletters/senders/${letter.feedId}/preview`,
    payload: senderPatch,
  });
  assert.equal(senderPreview.statusCode, 200);
  assert.match(senderPreview.headers['cache-control'], /private, no-store/);
  assert.equal(senderPreview.json().requiresConfirmation, true);
  assert.deepEqual(
    database.sqlite.prepare('SELECT total_changes() AS n').get(),
    senderChangesBefore,
  );
  const senderSaved = await app.inject({
    method: 'POST',
    url: '/api/actions',
    payload: {
      kind: 'update_sender',
      id: letter.feedId,
      patch: senderPatch,
      revision: senderPreview.json().revision,
      confirm: true,
      requestId: 'compiled-sender-settings',
    },
  });
  assert.equal(senderSaved.statusCode, 200);
  assert.equal(senderSaved.json().canUndo, true);
  assert.equal(
    (await app.inject(`/api/newsletters/letters/${letter.articleId}`)).json().sender.settings
      .blocked,
    true,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/actions/${senderSaved.json().id}/undo`,
        payload: {},
      })
    ).statusCode,
    200,
  );
  assert.deepEqual(
    database.sqlite.prepare('SELECT * FROM feeds WHERE id=?').get(letter.feedId),
    senderBefore,
  );
  assert.deepEqual(
    database.sqlite.prepare('SELECT * FROM brew_configs ORDER BY id').all(),
    senderBrewsBefore,
  );
  const hiddenBefore = database.sqlite
    .prepare('SELECT hidden FROM articles WHERE id=?')
    .get(letter.articleId);
  database.sqlite.prepare('UPDATE articles SET hidden=1 WHERE id=?').run(letter.articleId);
  const beforeHiddenReads = database.sqlite.prepare('SELECT total_changes() AS n').get();
  const hiddenLetter = (await app.inject('/api/articles-hidden?includeTotal=true'))
    .json()
    .items.find((item) => item.id === letter.articleId);
  assert.equal(hiddenLetter.kind, 'letter');
  assert.ok(Object.hasOwn(hiddenLetter, 'readAt'));
  assert.ok(Object.hasOwn(hiddenLetter, 'starredAt'));
  assert.ok(Object.hasOwn(hiddenLetter, 'highlightColor'));
  const hiddenTwin = (await app.inject('/feeds.json?section=hidden'))
    .json()
    .sections[0].items.find((item) => item.id === letter.articleId);
  assert.equal(hiddenTwin.details.kind, 'letter');
  assert.equal(new URL(hiddenTwin.url).pathname, `/a/${letter.articleId}`);
  assert.deepEqual(database.sqlite.prepare('SELECT total_changes() AS n').get(), beforeHiddenReads);
  database.sqlite
    .prepare('UPDATE articles SET hidden=? WHERE id=?')
    .run(hiddenBefore.hidden, letter.articleId);
  const subscriptions = (await app.inject('/api/feeds')).json();
  const exportedSubscriptions = await app.inject('/api/opml/export');
  assert.equal(exportedSubscriptions.statusCode, 200);
  assert.equal(exportedSubscriptions.headers['cache-control'], 'private, no-store');
  assert.equal(exportedSubscriptions.headers['x-robots-tag'], 'noindex, nofollow');
  assert.doesNotMatch(exportedSubscriptions.body, /mailto:/);
  const opml =
    '<opml><body><outline text="Compiled import" xmlUrl="https://compiled-import.test/rss"/></body></opml>';
  const opmlPreview = await app.inject({
    method: 'POST',
    url: '/api/opml/preview',
    payload: opml,
    headers: { 'content-type': 'text/x-opml' },
  });
  assert.equal(opmlPreview.statusCode, 200);
  assert.match(opmlPreview.headers['cache-control'], /private, no-store/);
  assert.equal(opmlPreview.json().imported, 1);
  assert.deepEqual((await app.inject('/api/feeds')).json(), subscriptions);
  const imported = await app.inject({
    method: 'POST',
    url: '/api/actions',
    payload: { kind: 'import_opml', opml, confirm: true, requestId: 'compiled-opml-import' },
  });
  assert.equal(imported.statusCode, 200);
  assert.equal(imported.json().imported, 1);
  assert.equal(imported.json().canUndo, true);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/actions/${imported.json().id}/undo`,
        payload: {},
      })
    ).statusCode,
    200,
  );
  assert.deepEqual((await app.inject('/api/feeds')).json(), subscriptions);
  const delivered = [];
  const posted = [];
  const deliveryApp = await createApp({
    database: openDatabase(':memory:'),
    publicUrl: 'https://compiled.example.test',
    outboundMail: {
      kind: 'smtp',
      send: async (message) => {
        delivered.push(message);
        return { messageId: 'compiled-message' };
      },
    },
    fetcher: async (_url, init) => {
      posted.push(JSON.parse(init.body));
      return new globalThis.Response(null, { status: 204 });
    },
  });
  try {
    const config = (
      await deliveryApp.inject({
        method: 'POST',
        url: '/api/brew-configs/composition',
        payload: {
          name: 'Compiled delivery',
          enabled: false,
          timezone: 'UTC',
          schedule: { kind: 'daily', time: '07:00' },
          delivery: {
            web: true,
            feed: false,
            publicCopy: false,
            email: { to: 'reader@example.test' },
            webhook: { url: 'https://receiver.example.test/hook' },
          },
          sections: [{ ...newBrewSection('note', 'note'), note: 'A compiled delivery.' }],
        },
      })
    ).json();
    const generated = await deliveryApp.inject({
      method: 'POST',
      url: `/api/brew-configs/${config.id}/generate`,
    });
    assert.equal(generated.statusCode, 200);
    assert.equal(delivered.length, 1);
    assert.equal(posted.length, 1);
    assert.match(delivered[0].text, /A compiled delivery/);
    assert.match(delivered[0].html, /width="600"/);
    const results = (await deliveryApp.inject(`/api/brews/${generated.json().id}/delivery`)).json()
      .results;
    assert.equal(results.email.status, 'sent');
    assert.equal(results.webhook.status, 'sent');
  } finally {
    await deliveryApp.close();
  }
  log(
    'Built Node target: migrations, MIME/cleaning, signed inbound webhook/replay, health, output twins/feeds/delivery, SMTP setup, SPA, assets and fallback passed outside the repository cwd.',
  );
} finally {
  if (app) await app.close();
  process.chdir(previousDirectory);
}
