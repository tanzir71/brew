import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../db/database.js';
import { feeds } from '../db/schema.js';
import { IngestPipeline } from '../services/ingest-pipeline.js';
import { PollerService } from '../services/poller-service.js';

const urls = [
  'https://hnrss.org/frontpage',
  'https://feeds.arstechnica.com/arstechnica/index',
  'https://www.theverge.com/rss/index.xml',
  'https://xkcd.com/rss.xml',
  'https://daringfireball.net/feeds/main',
  'https://www.smashingmagazine.com/feed/',
  'https://css-tricks.com/feed/',
  'https://github.blog/feed/',
  'https://stackoverflow.blog/feed/',
  'https://blog.cloudflare.com/rss/',
  'https://feeds.feedburner.com/codinghorror',
  'https://signal.org/blog/rss.xml',
  'https://www.eff.org/rss/updates.xml',
  'https://www.schneier.com/feed/atom/',
  'https://krebsonsecurity.com/feed/',
  'https://webkit.org/feed/atom/',
  'https://simonwillison.net/atom/everything/',
  'https://jvns.ca/atom.xml',
  'https://martinfowler.com/feed.atom',
  'https://openai.com/news/rss.xml',
];

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-m1-review-'));
const database = openDatabase(path.join(directory, 'review.db'));
try {
  for (const [index, url] of urls.entries()) database.db.insert(feeds).values({ title: `Live feed ${index + 1}`, url }).run();
  const ingest = new IngestPipeline(database);
  const poller = new PollerService(database, fetch, (feed, incoming) => ingest.ingest(feed, incoming));
  const first = await poller.pollDue();
  database.sqlite.prepare('UPDATE feeds SET last_fetched_at = NULL').run();
  const second = await poller.pollDue();
  const duplicateGuids = database.sqlite.prepare('SELECT feed_id, guid, count(*) AS count FROM articles GROUP BY feed_id, guid HAVING count(*) > 1').all();
  const duplicateHashes = database.sqlite.prepare('SELECT feed_id, hash, count(*) AS count FROM articles GROUP BY feed_id, hash HAVING count(*) > 1').all();
  const articleCount = (database.sqlite.prepare('SELECT count(*) AS count FROM articles').get() as { count: number }).count;
  const firstSuccesses = first.filter((result) => result.outcome !== 'error').length;
  const secondSuccesses = second.filter((result) => result.outcome !== 'error').length;
  console.log(JSON.stringify({ subscribed: urls.length, firstSuccesses, secondSuccesses, articleCount, duplicateGuidGroups: duplicateGuids.length, duplicateHashGroups: duplicateHashes.length, firstErrors: first.filter((result) => result.error).map((result) => ({ feedId: result.feedId, error: result.error })), secondErrors: second.filter((result) => result.error).map((result) => ({ feedId: result.feedId, error: result.error })) }, null, 2));
  if (duplicateGuids.length || duplicateHashes.length) process.exitCode = 1;
} finally {
  database.close();
  fs.rmSync(directory, { recursive: true, force: true });
}
