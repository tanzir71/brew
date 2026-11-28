import type { D1PreparedStatement } from '@cloudflare/workers-types';
import { SqlFeeds } from '../../../packages/db/src/sql-feed-service.js';
import { CloudflareStorage } from './storage.js';
import Parser from 'rss-parser';
const parser = new Parser();
export class CloudflareFeeds extends SqlFeeds<D1PreparedStatement> { constructor(storage: CloudflareStorage, fetcher: typeof fetch = globalThis.fetch, now: () => Date = () => new Date()) { super(storage, { parse: body => parser.parseString(body) }, fetcher, now); } }
