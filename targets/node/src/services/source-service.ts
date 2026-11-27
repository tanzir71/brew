import {
  sourceSearchesQuery,
  saveSourceSearchQuery,
  mailboxTableQuery,
  sourceMailboxQuery,
} from '../../../../packages/db/src/source-queries.js';
import Parser from 'rss-parser';
import {
  SourceDiscoveryService,
  sourceSearchInput,
  sourceMailbox,
} from '../../../../packages/core/src/source-discovery.js';
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
    return this.database.sqlite.prepare(sourceSearchesQuery).all() as SavedSourceSearch[];
  }
  saveSearch(value: { clientId: string; name: string; query: string }): SavedSourceSearch {
    const input = sourceSearchInput(value);
    return this.database.sqlite
      .prepare(saveSourceSearchQuery)
      .get(input.clientId, input.name, input.query) as SavedSourceSearch;
  }
  mailbox(): SourceMailbox {
    if (!this.database.sqlite.prepare(mailboxTableQuery).get()) return { address: null };
    const row = this.database.sqlite.prepare(sourceMailboxQuery).get() as
      { address: string } | undefined;
    return sourceMailbox(row?.address);
  }
}
