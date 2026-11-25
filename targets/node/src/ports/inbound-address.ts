import type { BrewDatabase } from '../db/database.js';
import type { NodeInboundConfig } from '../inbound-config.js';
import { normalizeNewsletterSender } from '../../../../packages/core/src/newsletter-mime.js';

export function activateInboundAddress(
  database: BrewDatabase,
  config?: NodeInboundConfig | null,
): void {
  database.sqlite.transaction(() => {
    database.sqlite.prepare('UPDATE inbound_addresses SET active=0 WHERE active<>0').run();
    if (config)
      database.sqlite
        .prepare(
          'INSERT INTO inbound_addresses(address,mechanism,active) VALUES(?,?,1) ON CONFLICT(address) DO UPDATE SET mechanism=excluded.mechanism,active=1',
        )
        .run(
          normalizeNewsletterSender(config.address),
          config.kind === 'imap' ? 'imap' : 'webhook',
        );
  })();
}
