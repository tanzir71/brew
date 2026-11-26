import type { OpenAPIDocument } from 'hono-openapi';

// Documentation only: the portable services remain the validation authority.
type SchemaObject = NonNullable<NonNullable<OpenAPIDocument['components']>['schemas']>[string];
export type Schema = SchemaObject | { $ref: string };
export const str = { type: 'string' as const };
export const bool = { type: 'boolean' as const };
export const int = { type: 'integer' as const };
export const id = { type: 'integer' as const, minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
export const count = { type: 'integer' as const, minimum: 0 };
export const date = { type: 'string' as const, format: 'date-time' };
export const nullable = (schema: Schema): SchemaObject => ({ anyOf: [schema, { type: 'null' }] });
export const array = (items: Schema): SchemaObject => ({ type: 'array', items });
export const values = (...items: string[]) => ({ type: 'string' as const, enum: items });
export const object = (
  properties: Record<string, Schema>,
  required = Object.keys(properties),
): SchemaObject => ({ type: 'object', properties, required });
export const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
export const pageNumber = { type: 'integer' as const, minimum: 1, maximum: 1_000_000, default: 1 };
export const paged = (items: Schema): SchemaObject =>
  object({ items: array(items), total: count, page: id, pageSize: id });
const nstr = nullable(str);
const ndate = nullable(date);
const nid = nullable(id);
const condition = object({
  field: values('title', 'content', 'author', 'url', 'feed', 'folder'),
  operator: values(
    'contains',
    'not_contains',
    'equals',
    'starts_with',
    'ends_with',
    'matches_regex',
  ),
  value: str,
});
const ruleScope = object({ feedIds: array(id), folderIds: array(id) }, []);
const ruleDefinition = {
  name: str,
  enabled: bool,
  position: int,
  matchType: values('all', 'any'),
  scope: ruleScope,
  conditions: array(condition),
  actions: array(ref('RuleAction')),
  stopProcessing: bool,
};
const article = {
  id,
  url: str,
  title: str,
  author: nstr,
  summaryHtml: nstr,
  imageUrl: nstr,
  highlightColor: nstr,
  enclosureUrl: nstr,
  enclosureType: nstr,
  publishedAt: date,
  readAt: ndate,
  starredAt: ndate,
  feedId: id,
  feedTitle: str,
  folderId: nid,
  folderTitle: nstr,
};
const section = {
  id: str,
  kind: values('items', 'note', 'divider'),
  title: str,
  sources: array(ref('BrewSource')),
  maxItems: int,
  layout: values('lead', 'magazine', 'grid', 'headlines'),
  depth: values('title', 'excerpt', 'full', 'brief'),
  images: bool,
  onlyUnread: bool,
  sort: values('newest', 'oldest', 'longest'),
  filter: object({ match: values('all', 'any'), conditions: array(condition) }),
  days: array(int),
  note: str,
};
const requiredSection = [
  'id',
  'kind',
  'title',
  'sources',
  'maxItems',
  'layout',
  'depth',
  'images',
  'onlyUnread',
  'sort',
];
const composition = {
  name: str,
  enabled: bool,
  timezone: str,
  schedule: ref('Schedule'),
  delivery: ref('Delivery'),
  sections: array(ref('Section')),
};
const senderSettings = {
  favorite: bool,
  skipInbox: bool,
  blocked: bool,
  brewId: id,
  onlyInBrew: bool,
  retentionDays: int,
  cleaning: object({ sponsorSelectors: array(str), footerSelectors: array(str) }, []),
};
const receiptKinds = values(
  'delete_feed',
  'delete_folder',
  'delete_rule',
  'apply_rule',
  'import_opml',
  'update_sender',
  'mark_read',
  'copy_rule',
  'star_item',
  'tag_item',
  'add_feed',
  'create_rule',
);
const requestFields = {
  confirm: { type: 'boolean', const: true } as Schema,
  requestId: { type: 'string', pattern: '^[a-zA-Z0-9_-]{16,80}$' } as Schema,
};
const action = (properties: Record<string, Schema>, required: string[]): SchemaObject =>
  object({ ...requestFields, ...properties }, ['kind', 'confirm', ...required]);
const opmlResult = { imported: count, skipped: count, foldersCreated: count };
const letter = {
  id,
  feedId: id,
  feedTitle: str,
  title: str,
  excerpt: str,
  publishedAt: date,
  readAt: ndate,
  starredAt: ndate,
};
const brewItem = object({
  id,
  title: str,
  url: str,
  author: nstr,
  summaryHtml: nstr,
  imageUrl: nstr,
  publishedAt: date,
  feedTitle: str,
  readTimeMinutes: count,
  readAt: ndate,
});

export const schemas: Record<string, SchemaObject> = {
  Error: object({ error: str, message: str, statusCode: int }, ['error']),
  Ok: object({ ok: { type: 'boolean', const: true } }),
  Feed: object({
    id,
    folderId: nid,
    url: str,
    siteUrl: nstr,
    title: str,
    description: nstr,
    fetchIntervalMinutes: int,
    lastFetchedAt: ndate,
    lastStatus: nullable(int),
    consecutiveFailures: count,
    failingSince: ndate,
    healthWarning: bool,
    retentionDays: int,
  }),
  Folder: object({ id, title: str, position: int }),
  FeedCandidate: object({ url: str, title: str, type: values('rss', 'atom', 'json') }),
  Tag: object({ id, name: str, color: str }),
  ArticleSummary: object(article),
  Article: object({
    ...article,
    contentHtml: nstr,
    fullTextHtml: nstr,
    readTimeMinutes: count,
    tags: array(ref('Tag')),
  }),
  ArticlePage: object({ items: array(ref('ArticleSummary')), nextCursor: nstr, total: count }, [
    'items',
    'nextCursor',
  ]),
  SearchPage: object(
    {
      items: array(ref('ArticleSummary')),
      nextOffset: nullable(count),
      durationMs: { type: 'number' },
      total: count,
    },
    ['items', 'nextOffset', 'durationMs'],
  ),
  ReaderFeed: object({ id, folderId: nid, title: str, unreadCount: count, muted: bool }),
  ReaderNavigation: object({
    counts: object({ all: count, today: count, starred: count }),
    folders: array(object({ id, title: str, unreadCount: count, feeds: array(ref('ReaderFeed')) })),
    unfiled: array(ref('ReaderFeed')),
  }),
  HiddenArticle: object({ id, title: str, feedTitle: str, publishedAt: int }),
  HiddenArticlePage: paged(
    object({
      id,
      title: str,
      feedTitle: str,
      publishedAt: int,
      kind: values('article', 'letter'),
      readAt: ndate,
      starredAt: ndate,
      highlightColor: nstr,
    }),
  ),
  RuleAction: {
    oneOf: [
      object({ type: values('add_tag', 'remove_tag'), tag: str }),
      object({
        type: values('star', 'mark_read', 'hide', 'feature_in_brew', 'exclude_from_brew', 'notify'),
      }),
      object({ type: values('highlight'), color: str }),
      object({ type: values('webhook'), url: str }),
    ],
  },
  RuleDraft: object(ruleDefinition, [
    'name',
    'enabled',
    'matchType',
    'scope',
    'conditions',
    'actions',
    'stopProcessing',
  ]),
  Rule: object({ ...ruleDefinition, id, hits24h: count, hits30d: count }, [
    'id',
    ...Object.keys(ruleDefinition),
  ]),
  RulePreviewInput: object({
    scope: ruleScope,
    matchType: values('all', 'any'),
    conditions: array(condition),
  }),
  RulePreviewItem: object({ id, title: str, feedTitle: str, publishedAt: date }),
  RulePreview: object(
    { items: array(ref('RulePreviewItem')), total: count, limit: { type: 'integer', const: 50 } },
    ['items'],
  ),
  RuleLog: object({
    id,
    articleId: id,
    articleTitle: str,
    executedAt: date,
    actions: array(object({ type: str, ok: bool, error: str }, ['type', 'ok'])),
  }),
  RuleLogPage: paged(ref('RuleLog')),
  ReadTarget: {
    oneOf: [
      {
        ...object({
          kind: values('items'),
          ids: { type: 'array', items: id, minItems: 1, maxItems: 50_000 },
        }),
        additionalProperties: false,
      },
      {
        ...object(
          {
            kind: values('reader'),
            view: values('all', 'today', 'starred'),
            feedId: id,
            folderId: id,
          },
          ['kind', 'view'],
        ),
        additionalProperties: false,
        not: { required: ['feedId', 'folderId'] },
      },
    ],
  },
  ReadPreview: object({ revision: str, updated: count, unavailable: count }),
  ActionRequest: {
    oneOf: [
      action({ kind: values('star_item'), id, starred: bool }, ['id', 'starred']),
      action({ kind: values('tag_item'), id, add: array(str), remove: array(str) }, ['id']),
      action({ kind: values('add_feed'), url: str, folderId: nullable(id) }, ['url']),
      action({ kind: values('create_rule'), draft: ref('RuleDraft') }, ['draft']),
      action(
        {
          kind: values('delete_feed', 'delete_folder', 'delete_rule', 'apply_rule'),
          id,
          days: { type: 'integer', minimum: 1, maximum: 3650 },
        },
        ['id'],
      ),
      action({ kind: values('import_opml'), opml: str }, ['opml']),
      action(
        {
          kind: values('update_sender'),
          id,
          patch: ref('SenderPatch'),
          revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        },
        ['id', 'patch', 'revision'],
      ),
      action(
        {
          kind: values('mark_read'),
          target: ref('ReadTarget'),
          revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        },
        ['target', 'revision'],
      ),
      action(
        {
          kind: values('copy_rule'),
          id,
          definition: {
            type: 'string',
            maxLength: 1_000_000,
            description:
              'Canonical saved-definition string from ruleCopySource; source ID and definition must still match.',
          },
        },
        ['id', 'definition'],
      ),
    ],
  },
  ActionReceipt: object(
    {
      id,
      kind: receiptKinds,
      targetId: nid,
      summary: str,
      status: values('pending', 'complete', 'failed', 'undone'),
      matched: count,
      failedActions: count,
      ...opmlResult,
      lettersRemoved: count,
      originalsRemoved: count,
      updated: count,
      externalEffects: bool,
      expiresAt: ndate,
      undoneAt: ndate,
      canUndo: bool,
    },
    [
      'id',
      'kind',
      'targetId',
      'summary',
      'status',
      'externalEffects',
      'expiresAt',
      'undoneAt',
      'canUndo',
    ],
  ),
  BrewSource: object(
    {
      kind: values(
        'folder',
        'feed',
        'tag',
        'starred',
        'featured',
        'today',
        'weekly_review',
        'newsletters',
        'saved_search',
      ),
      id,
      senderIds: array(id),
      tagIds: array(id),
    },
    ['kind'],
  ),
  Schedule: object(
    {
      kind: values('daily', 'weekdays', 'weekly', 'monthly'),
      days: array(int),
      dayOfMonth: int,
      time: str,
      skipIfFewerThan: count,
    },
    ['kind', 'time'],
  ),
  Delivery: object(
    {
      web: { type: 'boolean', const: true },
      feed: bool,
      email: object({ to: str }),
      webhook: object({ url: str }),
      publicCopy: bool,
    },
    ['web', 'feed', 'publicCopy'],
  ),
  Section: object(section, requiredSection),
  CompositionDraft: object(composition),
  Composition: object({ ...composition, id, createdAt: date, scheduleCron: str }),
  LegacySection: object(
    {
      id: str,
      title: str,
      divider: str,
      source: values('folder', 'feed', 'tag', 'starred', 'featured', 'today', 'weekly_review'),
      sourceId: id,
      maxItems: int,
      layout: values('lead', 'magazine', 'grid', 'headlines', 'hero', 'list'),
      sort: values('newest', 'longest'),
      onlyUnread: bool,
    },
    ['id', 'title', 'source', 'maxItems', 'layout', 'sort', 'onlyUnread'],
  ),
  LegacyBrewDraft: object({
    name: str,
    scheduleCron: str,
    enabled: bool,
    sections: array(ref('LegacySection')),
  }),
  LegacyBrew: object({
    id,
    name: str,
    scheduleCron: str,
    enabled: bool,
    sections: array(ref('LegacySection')),
    createdAt: date,
  }),
  LegacyIssue: object({
    id,
    brewConfigId: id,
    configName: str,
    generatedAt: date,
    sections: array({ allOf: [ref('LegacySection'), object({ items: array(brewItem) })] }),
    scrollPosition: { type: 'number' },
  }),
  Issue: object({
    version: { type: 'integer', const: 2 },
    id: {
      type: 'integer',
      minimum: 0,
      description: 'Zero for an unsaved preview; saved issues have positive IDs.',
    },
    issueNumber: id,
    brewConfigId: id,
    configName: str,
    generatedAt: date,
    timezone: str,
    sections: array({
      allOf: [
        ref('Section'),
        object(
          {
            items: array({
              allOf: [
                brewItem,
                object(
                  {
                    feedId: id,
                    contentHtml: nstr,
                    newsletter: object({ cleaning: nullable(ref('NewsletterCleaning')) }),
                  },
                  [],
                ),
              ],
            }),
            matchingItems: count,
            eligibleItems: count,
            noteHtml: str,
          },
          ['items', 'matchingItems', 'eligibleItems'],
        ),
      ],
    }),
    scrollPosition: { type: 'number' },
  }),
  BrewIssue: { anyOf: [ref('Issue'), ref('LegacyIssue')] },
  BrewPreview: object({
    snapshot: ref('Issue'),
    outputs: object(
      Object.fromEntries(
        ['web', 'email', 'text', 'markdown', 'json', 'feed', 'jsonFeed'].map((key) => [key, str]),
      ),
    ),
    warnings: array(str),
  }),
  BrewReadState: object({
    articles: array(
      object({
        id,
        feedId: nid,
        available: bool,
        readAt: ndate,
        starredAt: ndate,
        highlightColor: nstr,
        rules: array(object({ id, name: str })),
      }),
    ),
    timeZone: str,
    nextAt: ndate,
    scheduleLabel: str,
  }),
  DeliveryResult: object(
    {
      status: values('disabled', 'unavailable', 'pending', 'sent', 'failed'),
      attempts: count,
      attemptedAt: date,
      completedAt: date,
      messageId: str,
      httpStatus: int,
      error: values('unavailable', 'configuration', 'email', 'http', 'network', 'timeout'),
    },
    ['status', 'attempts'],
  ),
  DeliveryResults: object({
    version: { type: 'integer', const: 1 },
    email: ref('DeliveryResult'),
    webhook: ref('DeliveryResult'),
  }),
  SourceSearch: object({ id, clientId: str, name: str, query: str }),
  SourceDiscovery: object(
    {
      inputUrl: str,
      kind: values('web', 'youtube', 'subreddit', 'mastodon', 'bluesky', 'podcast'),
      candidates: array({ allOf: [ref('FeedCandidate'), object({ cadence: str }, [])] }),
      newsletter: object({ title: str }),
      notice: str,
    },
    ['inputUrl', 'kind', 'candidates'],
  ),
  OpmlResult: object(opmlResult),
  OpmlPreview: object({
    ...opmlResult,
    outlines: array(
      object({
        title: str,
        source: str,
        folder: nstr,
        status: values('add', 'subscribed', 'duplicate'),
      }),
    ),
  }),
  SenderSettings: object(senderSettings, [
    'favorite',
    'skipInbox',
    'blocked',
    'onlyInBrew',
    'retentionDays',
  ]),
  SenderPatch: object({ ...senderSettings, brewId: nid }, []),
  Sender: object({
    id,
    title: str,
    address: str,
    settings: ref('SenderSettings'),
    unreadCount: count,
    letterCount: count,
    latestAt: ndate,
  }),
  NewsletterOverview: object({
    senders: array(ref('Sender')),
    unreadCount: count,
    counts: object({ inbox: count, favorites: count, skipped: count, blocked: count }),
    brews: array(object({ id, name: str })),
  }),
  NewsletterPage: paged(object(letter)),
  NewsletterCleaning: object({ trackers: count, sponsorBlocks: count, footerTrimmed: bool }),
  NewsletterLetter: {
    allOf: [
      ref('Article'),
      object({
        sender: ref('Sender'),
        cleaning: nullable(ref('NewsletterCleaning')),
        originalAvailable: bool,
      }),
    ],
  },
  SenderPreview: object({
    senderTitle: str,
    revision: str,
    changes: array(object({ label: str, before: str, after: str })),
    lettersRemoved: count,
    originalsRemoved: count,
    requiresConfirmation: bool,
    blocksMail: bool,
  }),
  Capabilities: object(
    {
      mode: values('browser', 'node', 'cloudflare', 'php-lite', 'static'),
      fetch: values('direct', 'relay', 'extension', 'build-time'),
      backgroundFetch: object(
        {
          kind: values('always', 'while-open', 'cron', 'build-time'),
          everyMinutes: { type: 'number' },
        },
        ['kind'],
      ),
      inboundMail: nullable(values('cloudflare-email', 'imap', 'webhook', 'email-to-feed')),
      emailDelivery: nullable(values('smtp', 'cloudflare-email', 'resend', 'php-mail')),
      readerApi: bool,
      mcp: nullable(values('stdio+http', 'http')),
      agentAccess: bool,
      webmcp: bool,
      ai: object({
        available: array(values('byo', 'ollama', 'workers-ai', 'chrome-builtin')),
        configured: bool,
      }),
      readState: values('server', 'local'),
      publicCopy: bool,
      outputs: object({ twins: bool, feed: bool, webhook: bool }, ['feed', 'webhook']),
      actions: object({ undo: bool }),
      limits: object({ maxFetchesPerRun: int }, []),
    },
    [
      'mode',
      'fetch',
      'backgroundFetch',
      'inboundMail',
      'emailDelivery',
      'readerApi',
      'mcp',
      'webmcp',
      'ai',
      'readState',
      'publicCopy',
    ],
  ),
};
