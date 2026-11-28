import type { D1PreparedStatement } from '@cloudflare/workers-types';
import { SqlArticles } from '../../../packages/db/src/sql-article-service.js';
export class CloudflareArticles extends SqlArticles<D1PreparedStatement> {  }
