import type { XmlFeedParserPort } from '../../core/src/feed-parser.js';
import {
  SourceDiscoveryService,
  sourceSearchInput,
  sourceMailbox,
} from '../../core/src/source-discovery.js';
import type { SavedSourceSearch } from '../../core/src/types/sources.js';
import {
  sourceSearchesQuery,
  saveSourceSearchQuery,
  mailboxTableQuery,
  sourceMailboxQuery,
} from './source-queries.js';
import type { AsyncSqlStorage } from './async-storage.js';
import { libraryRevision } from './async-storage.js';

export class SqlSources<Statement> {
  private discovery: SourceDiscoveryService;
  constructor(
    private storage: AsyncSqlStorage<Statement>,
    parser: XmlFeedParserPort,
    fetcher: typeof fetch = globalThis.fetch,
  ) {
    this.discovery = new SourceDiscoveryService(fetcher, {
      parse: (body) => parser.parse(body),
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
