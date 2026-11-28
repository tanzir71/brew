import type { D1PreparedStatement } from '@cloudflare/workers-types';
import { SqlOpml } from '../../../packages/db/src/sql-opml-service.js';
export class CloudflareOpml extends SqlOpml<D1PreparedStatement> {  }
