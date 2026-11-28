import type { D1PreparedStatement } from '@cloudflare/workers-types';
import { SqlSources } from '../../../packages/db/src/sql-source-service.js';
import { CloudflareStorage } from './storage.js';
import Parser from 'rss-parser';
const parser = new Parser();
export class CloudflareSources extends SqlSources<D1PreparedStatement> { constructor(storage: CloudflareStorage, fetcher: typeof fetch = globalThis.fetch) { super(storage, { parse: body => parser.parseString(body) }, fetcher); } }
