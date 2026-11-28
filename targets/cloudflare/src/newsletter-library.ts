import type { D1PreparedStatement } from '@cloudflare/workers-types';
import { SqlNewsletterLibrary } from '../../../packages/db/src/sql-newsletter-library.js';
export class CloudflareNewsletterLibrary extends SqlNewsletterLibrary<D1PreparedStatement> {  }
