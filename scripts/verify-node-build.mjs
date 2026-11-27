import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { ruleCopySource } from '../dist/packages/core/src/rule-copy.js';
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
import { verifyMcpBuild } from './verify-mcp-build.mjs';
import { verifyReaderSyncBuild } from './verify-reader-sync-build.mjs';
import { RulesService } from '../dist/targets/node/src/services/rules-service.js';
import { NodeIngestStorage } from '../dist/targets/node/src/ports/ingest-storage.js';
import { IngestPipeline } from '../dist/targets/node/src/services/ingest-pipeline.js';
import { NodeBrewStorage } from '../dist/targets/node/src/ports/brew-storage.js';
import { NodeScheduledBrewJobs } from '../dist/targets/node/src/ports/brew-scheduled-jobs.js';
import { BrewService as ScheduledNodeService } from '../dist/targets/node/src/services/brew-service.js';
import { ScheduledBrewProcessor } from '../dist/packages/core/src/brew-scheduled-processing.js';
import { nodeRegex } from '../dist/targets/node/src/ports/runtime.js';
import { resendMailFromEnv } from '../dist/packages/core/src/resend-mail.js';

// A built install must find migrations and the SPA outside the repository cwd.
const previousDirectory = process.cwd();
process.chdir(tmpdir());
let app;
try {
  const database = openDatabase(':memory:');
  app = await createApp({ database, serveWeb: true });
  const health = await app.inject('/api/health');
  assert.deepEqual(health.json(), { ok: true });
  const beforeDiscovery = database.sqlite.prepare('SELECT total_changes() AS n').get();
  const discovery = await app.inject('/api/openapi.json');
  assert.equal(discovery.statusCode, 200);
  assert.equal(discovery.json().openapi, '3.1.0');
  assert.equal(discovery.headers['cache-control'], 'private, no-store');
  assert.equal(discovery.headers['x-robots-tag'], 'noindex, nofollow');
  assert.deepEqual(discovery.json().servers, [{ url: '/', description: 'This Brew instance' }]);
  assert.ok(discovery.json().paths['/api/actions'].post.requestBody);
  assert.ok(discovery.json().paths['/api/rules/{id}/executions'].get);
  assert.ok(discovery.json().paths['/b/{id}/compose.json'].get);
  const discoveryHead = await app.inject({ method: 'HEAD', url: '/api/openapi.json' });
  assert.equal(discoveryHead.statusCode, 200);
  assert.equal(discoveryHead.body, '');
  const guide = await app.inject('/llms.txt');
  assert.equal(guide.statusCode, 200);
  assert.match(guide.headers['content-type'], /^text\/plain; charset=utf-8$/i);
  assert.equal(guide.headers['cache-control'], 'private, no-store');
  assert.equal(guide.headers['x-robots-tag'], 'noindex, nofollow');
  assert.match(guide.body, /^# Brew instance guide\n/);
  assert.match(guide.body, /Authorization: Bearer <Brew token>/);
  assert.match(guide.body, /\[mark_read\]\(\/mcp\)/);
  const guideHead = await app.inject({ method: 'HEAD', url: '/llms.txt' });
  assert.equal(guideHead.statusCode, 200);
  assert.equal(guideHead.body, '');
  assert.equal((await app.inject({ method: 'POST', url: '/llms.txt' })).statusCode, 404);
  assert.deepEqual(database.sqlite.prepare('SELECT total_changes() AS n').get(), beforeDiscovery);
  const capabilities = await app.inject('/api/capabilities');
  assert.equal(capabilities.statusCode, 200);
  assert.equal(capabilities.json().mode, 'node');
  assert.equal(capabilities.headers['cache-control'], 'no-store');
  const page = await app.inject('/');
  assert.equal(page.statusCode, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.body, /<link rel="describedby" href="\/llms\.txt"/);
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
  const copySource = (
    await app.inject({
      method: 'POST',
      url: '/api/rules',
      payload: {
        name: 'Compiled copy source',
        enabled: false,
        matchType: 'all',
        scope: {},
        conditions: [{ field: 'title', operator: 'contains', value: 'compiled' }],
        actions: [{ type: 'star' }],
        stopProcessing: false,
      },
    })
  ).json();
  const copyRequest = {
    kind: 'copy_rule',
    id: copySource.id,
    definition: ruleCopySource(copySource),
    confirm: true,
    requestId: 'compiled-rule-copy-01',
  };
  const copied = await app.inject({ method: 'POST', url: '/api/actions', payload: copyRequest });
  assert.equal(copied.statusCode, 200);
  assert.equal(copied.headers['cache-control'], 'private, no-store');
  assert.equal(copied.json().canUndo, true);
  assert.equal(
    (await app.inject('/api/rules')).json().find((rule) => rule.id === copied.json().targetId).enabled,
    false,
  );
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/actions', payload: copyRequest })).json().id,
    copied.json().id,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/actions/${copied.json().id}/undo`,
        payload: {},
      })
    ).json().status,
    'undone',
  );
  assert.equal(
    (await app.inject('/api/rules')).json().some((rule) => rule.id === copied.json().targetId),
    false,
  );
  assert.equal(
    (await app.inject('/api/rules')).json().find((rule) => rule.id === copySource.id).name,
    copySource.name,
  );
  database.sqlite.transaction(() => {
    const insert = database.sqlite.prepare('INSERT INTO rule_logs(rule_id,article_id,executed_at,actions_taken_json) VALUES(?,?,?,?)');
    for (let i = 0; i < 106; i++) insert.run(copySource.id, letter.articleId, Date.now(), '[{"type":"star","ok":true}]');
  })();
  const executionChanges = database.sqlite.prepare('SELECT total_changes() AS n').get();
  const executionPage = await app.inject(`/api/rules/${copySource.id}/executions?page=3`);
  assert.equal(executionPage.headers['cache-control'], 'private, no-store');
  assert.equal(executionPage.json().total, 106);
  assert.equal(executionPage.json().items.length, 6);
  const executionTwin = (await app.inject(`/rules/${copySource.id}.json?tab=log&page=3`)).json();
  assert.equal(executionTwin.sections[1].text, 'Showing 101–106 of 106 executions');
  assert.equal(executionTwin.sections[1].items.length, 6);
  const countedPreview = await app.inject({ method: 'POST', url: '/api/rules/preview?includeTotal=true', payload: { scope: {}, matchType: 'all', conditions: [] } });
  assert.equal(countedPreview.headers['cache-control'], 'private, no-store');
  assert.equal(countedPreview.json().total, database.sqlite.prepare('SELECT count(*) AS n FROM articles WHERE hidden=0').get().n);
  assert.deepEqual(database.sqlite.prepare('SELECT total_changes() AS n').get(), executionChanges);
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
  const tagArticleBefore = database.sqlite.prepare('SELECT * FROM articles WHERE id=?').get(letter.articleId);
  const tagAssignmentsBefore = database.sqlite.prepare('SELECT * FROM article_tags ORDER BY article_id,tag_id').all();
  const tagFrozenBefore = database.sqlite.prepare('SELECT id,payload_json FROM brews ORDER BY id').all();
  const tagDefinition = (await app.inject({ method: 'POST', url: '/api/tags', payload: { name: 'Compiled triage' } })).json();
  const tagPatch = await app.inject({ method: 'PATCH', url: `/api/articles/${letter.articleId}/tags`, payload: { add: [tagDefinition.id], remove: [] } });
  assert.equal(tagPatch.statusCode, 200);
  assert.equal(tagPatch.headers['cache-control'], 'private, no-store');
  assert.ok(tagPatch.json().tags.some((tag) => tag.id === tagDefinition.id));
  const beforeTagReplay = database.sqlite.prepare('SELECT total_changes() AS n').get();
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/articles/${letter.articleId}/tags`, payload: { add: [tagDefinition.id] } })).statusCode, 200);
  assert.deepEqual(database.sqlite.prepare('SELECT total_changes() AS n').get(), beforeTagReplay);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/articles/${letter.articleId}/tags`, payload: { remove: [tagDefinition.id] } })).statusCode, 200);
  assert.deepEqual(database.sqlite.prepare('SELECT * FROM article_tags ORDER BY article_id,tag_id').all(), tagAssignmentsBefore);
  assert.deepEqual(database.sqlite.prepare('SELECT * FROM articles WHERE id=?').get(letter.articleId), tagArticleBefore);
  assert.deepEqual(database.sqlite.prepare('SELECT id,payload_json FROM brews ORDER BY id').all(), tagFrozenBefore);
  const readRowsBefore = database.sqlite
    .prepare('SELECT id,read_at,starred_at FROM articles ORDER BY id')
    .all();
  const readPreview = await app.inject({
    method: 'POST',
    url: '/api/actions/mark-read/preview',
    payload: { kind: 'items', ids: [letter.articleId] },
  });
  assert.equal(readPreview.statusCode, 200);
  assert.equal(readPreview.json().updated, 1);
  assert.equal(readPreview.headers['cache-control'], 'private, no-store');
  assert.deepEqual(
    database.sqlite.prepare('SELECT id,read_at,starred_at FROM articles ORDER BY id').all(),
    readRowsBefore,
  );
  const readAction = await app.inject({
    method: 'POST',
    url: '/api/actions',
    payload: {
      kind: 'mark_read',
      target: { kind: 'items', ids: [letter.articleId] },
      revision: readPreview.json().revision,
      requestId: 'compiled-bulk-read-action',
      confirm: true,
    },
  });
  assert.equal(readAction.statusCode, 200);
  assert.equal(readAction.json().updated, readPreview.json().updated);
  assert.equal(readAction.json().canUndo, true);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/actions/${readAction.json().id}/undo`,
        payload: {},
      })
    ).statusCode,
    200,
  );
  assert.deepEqual(
    database.sqlite.prepare('SELECT id,read_at,starred_at FROM articles ORDER BY id').all(),
    readRowsBefore,
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
  const ruleDatabase = openDatabase(':memory:');
  try {
    ruleDatabase.sqlite.prepare("INSERT INTO feeds(id,url,title) VALUES(1,'https://compiled.test/rss','Compiled')").run();
    ruleDatabase.sqlite.prepare("INSERT INTO articles(id,feed_id,guid,hash,url,title,published_at) VALUES(1,1,'compiled','compiled','https://compiled.test/one','Compiled actions',?)").run(Date.now());
    const ruleService = new RulesService(ruleDatabase);
    const localRule = ruleService.create({
      name: 'Compiled local actions', enabled: true, scope: {}, matchType: 'all', conditions: [], stopProcessing: false,
      actions: [{ type: 'add_tag', tag: 'Temporary' }, { type: 'remove_tag', tag: 'Temporary' },
        { type: 'add_tag', tag: 'Retained' }, { type: 'star' }],
    });
    assert.equal(await ruleService.evaluateArticle(1), 1);
    assert.deepEqual(ruleDatabase.sqlite.prepare('SELECT t.name FROM article_tags at JOIN tags t ON t.id=at.tag_id WHERE at.article_id=1').all(), [{ name: 'Retained' }]);
    assert.ok(ruleDatabase.sqlite.prepare('SELECT starred_at FROM articles WHERE id=1').get().starred_at);
    assert.deepEqual(JSON.parse(ruleDatabase.sqlite.prepare('SELECT actions_taken_json FROM rule_logs WHERE rule_id=?').get(localRule.id).actions_taken_json), [
      { type: 'add_tag', ok: true }, { type: 'remove_tag', ok: true }, { type: 'add_tag', ok: true }, { type: 'star', ok: true },
    ]);
    const queued=new NodeIngestStorage(ruleDatabase,true);
    const pendingArticle={feedId:1,guid:'pending',hash:'pending',url:'https://compiled.test/pending',title:'Pending compiled actions',author:null,summaryHtml:null,contentHtml:'<p>Pending.</p>',imageUrl:null,enclosureUrl:null,enclosureType:null,publishedAt:new Date()};
    assert.deepEqual(queued.insertBatch([{feedId:1,guid:'pending',hash:'pending',prepare:()=>pendingArticle}]),[2]);
    assert.equal(ruleDatabase.sqlite.prepare('SELECT count(*) AS n FROM ingest_jobs').get().n,1);
    await new IngestPipeline(ruleDatabase,ruleService).resumePending();
    assert.equal(ruleDatabase.sqlite.prepare('SELECT count(*) AS n FROM ingest_jobs').get().n,0);
    assert.ok(ruleDatabase.sqlite.prepare('SELECT starred_at FROM articles WHERE id=2').get().starred_at);
    assert.equal(ruleDatabase.sqlite.prepare('SELECT count(*) AS n FROM rule_logs WHERE article_id=2').get().n,1);
  } finally {
    ruleDatabase.close();
  }
  const scheduleDatabase = openDatabase(':memory:');
  try {
    let time = Date.parse('2026-11-27T12:00:00Z');
    const clock = { now: () => new Date(time), monotonic: () => globalThis.performance.now() };
    const storage = new NodeBrewStorage(scheduleDatabase);
    scheduleDatabase.sqlite.prepare("INSERT INTO feeds(id,url,title) VALUES(1,'https://compiled.example.test/captured','Captured feed')").run();
    const insertCaptured = scheduleDatabase.sqlite.prepare("INSERT INTO articles(feed_id,guid,hash,url,title,content_html,published_at) VALUES(1,?,?,'https://compiled.example.test/story',?,?,?)");
    for (let index=0;index<35;index++) insertCaptured.run(String(index),String(index),`Captured ${index}`,'<p>Original compiled content.</p>',time-index*1000);
    const id = storage.createComposition({name:'Compiled pending schedule',enabled:true,timezone:'UTC',schedule:{kind:'daily',time:'12:00'},delivery:{web:true,feed:false,publicCopy:false},sections:[{...newBrewSection('first'),onlyUnread:false,depth:'full',maxItems:2,sources:[{kind:'feed',id:1}]},{...newBrewSection('second','note'),note:'Second compiled note.'}]});
    const laterConfig=storage.createComposition({name:'Compiled captured definition',enabled:true,timezone:'UTC',schedule:{kind:'daily',time:'12:00'},delivery:{web:true,feed:false,publicCopy:false},sections:[{...newBrewSection('definition','note'),note:'Captured definition.'}]});
    const work = new ScheduledBrewProcessor(new NodeScheduledBrewJobs(scheduleDatabase),storage,clock,nodeRegex,{},()=>globalThis.crypto.randomUUID(),{remaining:Infinity,configPageSize:1,capturePages:1});
    await work.capture(); await work.drain(1);
    assert.equal(scheduleDatabase.sqlite.prepare('SELECT count(*) AS n FROM brew_schedule_jobs').get().n,1);
    assert.equal(scheduleDatabase.sqlite.prepare('SELECT count(*) AS n FROM brew_schedule_candidates').get().n,35);
    assert.equal(scheduleDatabase.sqlite.prepare('SELECT count(*) AS n FROM brew_schedule_configs').get().n,2);
    scheduleDatabase.sqlite.prepare("UPDATE brew_configs SET enabled=0,name='Changed live',sections_json='[]' WHERE id=?").run(laterConfig);
    assert.ok(scheduleDatabase.sqlite.prepare('SELECT length(state_json) AS bytes FROM brew_schedule_jobs').get().bytes<16384);
    scheduleDatabase.sqlite.prepare('DELETE FROM articles').run();
    time += 60_000;
    await new ScheduledNodeService(scheduleDatabase,clock).runPendingScheduled(false);
    assert.equal(scheduleDatabase.sqlite.prepare('SELECT count(*) AS n FROM brew_schedule_jobs').get().n,0);
    const issue = storage.snapshot(storage.historyIds(id)[0]);
    assert.equal(issue.generatedAt,'2026-11-27T12:00:00.000Z'); assert.equal(issue.sections.length,2);
    assert.equal(issue.sections[0].eligibleItems,35);assert.equal(issue.sections[0].matchingItems,35);
    assert.deepEqual(issue.sections[0].items.map(row=>row.id),[1,2]);
    assert.ok(issue.sections[0].items[0].contentHtml.includes('Original compiled content.'));
    assert.equal(scheduleDatabase.sqlite.prepare('SELECT count(*) AS n FROM brew_schedule_candidates').get().n,0);
    assert.equal(scheduleDatabase.sqlite.prepare('SELECT count(*) AS n FROM brew_schedule_configs').get().n,0);
    assert.equal(scheduleDatabase.sqlite.prepare('SELECT count(*) AS n FROM brew_schedule_captures').get().n,0);
    const laterIssue=storage.snapshot(storage.historyIds(laterConfig)[0]);
    assert.equal(laterIssue.configName,'Compiled captured definition');assert.ok(laterIssue.sections[0].noteHtml.includes('Captured definition.'));
    assert.equal(storage.deliveryResults(issue.id).webhook.status,'disabled');
  } finally { scheduleDatabase.close(); }
  const posted = [];
  const deliveryApp = await createApp({
    database: openDatabase(':memory:'),
    publicUrl: 'https://compiled.example.test',
    outboundMail: resendMailFromEnv({BREW_RESEND_API_KEY:'re_compiled_fixture',BREW_RESEND_FROM:'brew@example.test'},async(input,init)=>{
      const request=new globalThis.Request(input,init);
      assert.equal(request.url,'https://api.resend.com/emails');assert.equal(request.headers.get('authorization'),'Bearer re_compiled_fixture');
      assert.equal(request.headers.get('user-agent'),'Brew/0.1');assert.match(request.headers.get('idempotency-key'),/^brew\/[a-f\d]{64}$/);
      delivered.push(await request.json());return globalThis.Response.json({id:'compiled-resend'});
    }),
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
    assert.equal(results.email.messageId,'compiled-resend');
    assert.equal(results.webhook.status, 'sent');
  } finally {
    await deliveryApp.close();
  }
  log(
    await verifyMcpBuild().then(()=> 'Built MCP: HTTP triage, reopened CLI stdio replay and real Undo passed outside the repository cwd.'),
  );
  await verifyReaderSyncBuild();
  log('Built Reader sync: app password, Google Reader IDs/content/state, Fever, namespace isolation and revocation passed outside the repository cwd.');
  log(
    'Built Node target: migrations, MIME/cleaning, signed inbound webhook/replay, health, output twins/feeds/delivery, SMTP setup, SPA, assets and fallback passed outside the repository cwd.',
  );
} finally {
  if (app) await app.close();
  process.chdir(previousDirectory);
}
