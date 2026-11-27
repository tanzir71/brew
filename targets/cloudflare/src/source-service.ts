import Parser from 'rss-parser';
import {
  SourceDiscoveryService,
  sourceSearchInput,
  sourceMailbox,
} from '../../../packages/core/src/source-discovery.js';
import type { SavedSourceSearch } from '../../../packages/core/src/types/sources.js';
import {
  sourceSearchesQuery,
  saveSourceSearchQuery,
  mailboxTableQuery,
  sourceMailboxQuery,
} from '../../../packages/db/src/source-queries.js';
import { CloudflareStorage } from './storage.js';
import { libraryRevision } from './events.js';

const parser = new Parser();
export class CloudflareSources {
  private discovery: SourceDiscoveryService;
  constructor(
    private storage: CloudflareStorage,
    fetcher: typeof fetch = globalThis.fetch,
  ) {
    this.discovery = new SourceDiscoveryService(fetcher, {
      parse: (body) => parser.parseString(body),
    });
  }
  discover(input: string) {
    return this.discovery.discover(input);
  }
  async searches() {
    return this.storage.all<SavedSourceSearch>(sourceSearchesQuery);
  }
  async saveSearch(input: { clientId: string; name: string; query: string }) {
    const value = sourceSearchInput(input);
    const result = await this.storage.batch([
      this.storage.statement(saveSourceSearchQuery, [value.clientId, value.name, value.query]),
      libraryRevision(this.storage),
    ]);
    return result[0]!.results[0] as unknown as SavedSourceSearch;
  }
  async mailbox() {
    if (!(await this.storage.first(mailboxTableQuery))) return { address: null };
    return sourceMailbox(
      (await this.storage.first<{ address: string }>(sourceMailboxQuery))?.address,
    );
  }
}
