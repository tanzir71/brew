import Parser from 'rss-parser';
import { SourceDiscoveryService } from '../../../../packages/core/src/source-discovery.js';
import type {
  SavedSourceSearch,
  SourceMailbox,
} from '../../../../packages/core/src/types/sources.js';
import type { BrewDatabase } from '../db/database.js';
const parser = new Parser();
export class SourceService {
  private discovery: SourceDiscoveryService;
  constructor(
    private database: BrewDatabase,
    fetcher: typeof fetch = fetch,
  ) {
    this.discovery = new SourceDiscoveryService(fetcher, {
      parse: (body) => parser.parseString(body),
    });
  }
  discover(input: string) {
    return this.discovery.discover(input);
  }
  searches(): SavedSourceSearch[] {
    return this.database.sqlite
      .prepare(
        'SELECT id,client_id AS clientId,name,query FROM saved_source_searches ORDER BY name,id',
      )
      .all() as SavedSourceSearch[];
  }
  saveSearch(value: { clientId: string; name: string; query: string }): SavedSourceSearch {
    if (
      !value ||
      ![value.clientId, value.name, value.query].every(
        (item) => typeof item === 'string' && item.trim(),
      )
    )
      throw new Error('Saved search needs a name, query and stable ID.');
    return this.database.sqlite
      .prepare(
        'INSERT INTO saved_source_searches(client_id,name,query) VALUES(?,?,?) ON CONFLICT(client_id) DO UPDATE SET name=excluded.name,query=excluded.query RETURNING id,client_id AS clientId,name,query',
      )
      .get(value.clientId, value.name.trim(), value.query.trim()) as SavedSourceSearch;
  }
  mailbox(): SourceMailbox {
    if (
      !this.database.sqlite
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='inbound_addresses'")
        .get()
    )
      return { address: null };
    const row = this.database.sqlite
      .prepare('SELECT address FROM inbound_addresses WHERE active=1 ORDER BY id LIMIT 1')
      .get() as { address: string } | undefined;
    return { address: row && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.address) ? row.address : null };
  }
}
