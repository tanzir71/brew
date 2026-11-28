import type { D1PreparedStatement } from '@cloudflare/workers-types';
import { SqlActionStorage, type SqlActionOptions } from '../../../packages/db/src/sql-action-storage.js';
import { isD1Constraint } from './sqlite-errors.js';
import { CloudflareStorage } from './storage.js';
import Parser from 'rss-parser';
const parser = new Parser();
export class CloudflareActionStorage extends SqlActionStorage<D1PreparedStatement> { constructor(storage: CloudflareStorage, options: Omit<SqlActionOptions, 'parser' | 'isConstraint'>) { super(storage, { ...options, parser: { parse: body => parser.parseString(body) }, isConstraint: isD1Constraint }); } }
