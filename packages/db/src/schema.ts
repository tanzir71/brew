import { sql } from 'drizzle-orm';
import {
  index,
  check,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });

export const folders = sqliteTable('folders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at')
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const feeds = sqliteTable(
  'feeds',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    folderId: integer('folder_id').references(() => folders.id, { onDelete: 'set null' }),
    url: text('url').notNull(),
    kind: text('kind', { enum: ['rss', 'newsletter'] })
      .notNull()
      .default('rss'),
    settingsJson: text('settings_json').notNull().default('{}'),
    siteUrl: text('site_url'),
    title: text('title').notNull(),
    description: text('description'),
    faviconUrl: text('favicon_url'),
    fetchIntervalMinutes: integer('fetch_interval_minutes').notNull().default(30),
    etag: text('etag'),
    lastModified: text('last_modified'),
    lastFetchedAt: timestamp('last_fetched_at'),
    lastStatus: integer('last_status'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    failingSince: timestamp('failing_since'),
    retentionDays: integer('retention_days').notNull().default(90),
    fullTextMode: integer('full_text_mode', { mode: 'boolean' }).notNull().default(false),
    muted: integer('muted', { mode: 'boolean' }).notNull().default(false),
    createdAt: timestamp('created_at')
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [uniqueIndex('feeds_url_unique').on(table.url)],
);

export const articles = sqliteTable(
  'articles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    feedId: integer('feed_id')
      .notNull()
      .references(() => feeds.id, { onDelete: 'cascade' }),
    guid: text('guid').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    author: text('author'),
    summaryHtml: text('summary_html'),
    contentHtml: text('content_html'),
    fullTextHtml: text('full_text_html'),
    rawHtml: text('raw_html'),
    cleaningJson: text('cleaning_json'),
    imageUrl: text('image_url'),
    enclosureUrl: text('enclosure_url'),
    enclosureType: text('enclosure_type'),
    publishedAt: timestamp('published_at').notNull(),
    fetchedAt: timestamp('fetched_at')
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    readAt: timestamp('read_at'),
    starredAt: timestamp('starred_at'),
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
    highlightColor: text('highlight_color'),
    featuredInBrew: integer('featured_in_brew', { mode: 'boolean' }).notNull().default(false),
    excludedFromBrew: integer('excluded_from_brew', { mode: 'boolean' }).notNull().default(false),
    hash: text('hash').notNull(),
  },
  (table) => [
    uniqueIndex('articles_feed_guid_unique').on(table.feedId, table.guid),
    index('articles_feed_published_idx').on(table.feedId, table.publishedAt),
    index('articles_read_idx').on(table.readAt),
    index('articles_hash_idx').on(table.hash),
  ],
);

export const tags = sqliteTable(
  'tags',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    color: text('color').notNull(),
  },
  (table) => [uniqueIndex('tags_name_unique').on(table.name)],
);

export const articleTags = sqliteTable(
  'article_tags',
  {
    articleId: integer('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.articleId, table.tagId] })],
);

export const rules = sqliteTable('rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  position: integer('position').notNull().default(0),
  matchType: text('match_type', { enum: ['all', 'any'] }).notNull(),
  scopeJson: text('scope_json').notNull(),
  conditionsJson: text('conditions_json').notNull(),
  actionsJson: text('actions_json').notNull(),
  stopProcessing: integer('stop_processing', { mode: 'boolean' }).notNull().default(false),
  createdAt: timestamp('created_at')
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: timestamp('updated_at')
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const ruleLogs = sqliteTable(
  'rule_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ruleId: integer('rule_id')
      .notNull()
      .references(() => rules.id, { onDelete: 'cascade' }),
    articleId: integer('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    executedAt: timestamp('executed_at')
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    actionsTakenJson: text('actions_taken_json').notNull(),
  },
  (table) => [index('rule_logs_rule_executed_idx').on(table.ruleId, table.executedAt)],
);

export const brewConfigs = sqliteTable('brew_configs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  scheduleCron: text('schedule_cron').notNull().default('0 7 * * *'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  sectionsJson: text('sections_json').notNull().default('[]'),
  timezone: text('timezone').notNull().default('UTC'),
  scheduleJson: text('schedule_json').notNull().default('{"kind":"daily","time":"07:00"}'),
  deliveryJson: text('delivery_json')
    .notNull()
    .default('{"web":true,"feed":false,"publicCopy":false}'),
  legacySectionsJson: text('legacy_sections_json'),
  compositionVersion: integer('composition_version').notNull().default(1),
  createdAt: timestamp('created_at')
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const brews = sqliteTable('brews', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  brewConfigId: integer('brew_config_id')
    .notNull()
    .references(() => brewConfigs.id, { onDelete: 'cascade' }),
  generatedAt: timestamp('generated_at')
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  payloadJson: text('payload_json').notNull(),
  issueNumber: integer('issue_number'),
  renderedMd: text('rendered_md'),
  renderedJson: text('rendered_json'),
  sentJson: text('sent_json'),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const savedSourceSearches = sqliteTable('saved_source_searches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clientId: text('client_id').notNull().unique(),
  name: text('name').notNull(),
  query: text('query').notNull(),
});

export const inboundAddresses = sqliteTable('inbound_addresses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  address: text('address').notNull().unique(),
  mechanism: text('mechanism', {
    enum: ['imap', 'webhook', 'cloudflare-email', 'email-to-feed'],
  }).notNull(),
  createdAt: timestamp('created_at')
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});
export const inboundReceipts = sqliteTable(
  'inbound_receipts',
  {
    key: text('key').primaryKey(),
    requestHash: text('request_hash').notNull(),
    resultJson: text('result_json').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (table) => [index('inbound_receipts_expiry').on(table.expiresAt)],
);

export const apiTokens = sqliteTable('api_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  scopes: text('scopes', { enum: ['read', 'write'] }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').notNull(),
});
export const agentActions = sqliteTable('agent_actions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tokenId: integer('token_id'),
  requestId: text('request_id').unique(),
  agent: text('agent').notNull(),
  tool: text('tool').notNull(),
  argsJson: text('args_json').notNull(),
  resultJson: text('result_json').notNull(),
  undoJson: text('undo_json'),
  createdAt: timestamp('created_at').notNull(),
  undoneAt: timestamp('undone_at'),
});
export const agentActionChanges = sqliteTable(
  'agent_action_changes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actionId: integer('action_id')
      .notNull()
      .references(() => agentActions.id, { onDelete: 'cascade' }),
    tableName: text('table_name').notNull(),
    keyJson: text('key_json').notNull(),
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
  },
  (table) => [index('agent_action_changes_action').on(table.actionId, table.id)],
);

export const readerAccess = sqliteTable('reader_access', {
  id: integer('id').primaryKey(),
  username: text('username').notNull(),
  salt: text('salt').notNull(),
  passwordHash: text('password_hash').notNull(),
  feverHash: text('fever_hash').notNull(),
  generation: text('generation').notNull(),
  createdAt: timestamp('created_at').notNull(),
});
export const readerSessions = sqliteTable(
  'reader_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    writeHash: text('write_hash').notNull().unique(),
    generation: text('generation').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => [index('reader_sessions_expiry').on(table.expiresAt)],
);

export const instanceEvents = sqliteTable('instance_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  articleId: integer('article_id').references(() => articles.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  dataJson: text('data_json').notNull(),
  createdAt: timestamp('created_at')
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const feedPollLeases = sqliteTable(
  'feed_poll_leases',
  {
    feedId: integer('feed_id')
      .primaryKey()
      .references(() => feeds.id, { onDelete: 'cascade' }),
    runner: text('runner').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (table) => [index('feed_poll_leases_expiry').on(table.expiresAt)],
);

export const ingestJobs = sqliteTable(
  'ingest_jobs',
  {
    sequence: integer('sequence').primaryKey({ autoIncrement: true }),
    id: text('id').notNull().unique(),
    feedId: integer('feed_id')
      .notNull()
      .references(() => feeds.id, { onDelete: 'cascade' }),
    stateJson: text('state_json').notNull().default('{"phase":"duplicates"}'),
    version: integer('version').notNull().default(0),
    runner: text('runner'),
    expiresAt: timestamp('expires_at')
      .notNull()
      .default(sql`0`),
    createdAt: timestamp('created_at')
      .notNull()
      .default(sql`(unixepoch()*1000)`),
  },
  (table) => [
    index('ingest_jobs_ready').on(table.expiresAt, table.sequence),
    uniqueIndex('ingest_jobs_runner').on(table.runner),
  ],
);
export const ingestJobItems = sqliteTable(
  'ingest_job_items',
  {
    articleId: integer('article_id')
      .primaryKey()
      .references(() => articles.id, { onDelete: 'cascade' }),
    jobId: text('job_id')
      .notNull()
      .references(() => ingestJobs.id, { onDelete: 'cascade' }),
  },
  (table) => [index('ingest_job_items_job').on(table.jobId, table.articleId)],
);
export const ingestJobGuard = sqliteTable(
  'ingest_job_guard',
  { id: integer('id').primaryKey(), valid: integer('valid').notNull() },
  (table) => [
    check('ingest_guard_id', sql`${table.id}=1`),
    check('brew_ingest_lease', sql`${table.valid}=1`),
  ],
);

export const brewScheduleJobs = sqliteTable(
  'brew_schedule_jobs',
  {
    sequence: integer('sequence').primaryKey({ autoIncrement: true }),
    id: text('id').notNull().unique(),
    configId: integer('config_id')
      .notNull()
      .references(() => brewConfigs.id, { onDelete: 'cascade' }),
    requestJson: text('request_json').notNull(),
    stateJson: text('state_json').notNull(),
    version: integer('version').notNull().default(0),
    runner: text('runner'),
    expiresAt: integer('expires_at').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    sourceVersion: integer('source_version').notNull().default(1),
  },
  (table) => [
    index('brew_schedule_jobs_ready').on(table.expiresAt, table.sequence),
    uniqueIndex('brew_schedule_jobs_runner').on(table.runner),
  ],
);
export const brewScheduleGuard = sqliteTable(
  'brew_schedule_guard',
  {
    id: integer('id').primaryKey(),
    valid: integer('valid').notNull(),
  },
  (table) => [
    check('brew_schedule_guard_id', sql`${table.id}=1`),
    check('brew_schedule_lease', sql`${table.valid}=1`),
  ],
);

export const brewScheduleCandidates = sqliteTable(
  'brew_schedule_candidates',
  {
    jobId: text('job_id')
      .notNull()
      .references(() => brewScheduleJobs.id, { onDelete: 'cascade' }),
    sectionIndex: integer('section_index').notNull(),
    articleId: integer('article_id').notNull(),
    format: integer('format').notNull().default(1),
    snapshotJson: text('snapshot_json').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.sectionIndex, table.articleId] }),
    check('brew_schedule_candidate_format', sql`${table.format} IN (0,1)`),
  ],
);

export const schema = {
  brewScheduleCandidates,
  brewScheduleJobs,
  brewScheduleGuard,
  ingestJobs,
  ingestJobItems,
  ingestJobGuard,
  feedPollLeases,
  instanceEvents,
  readerAccess,
  readerSessions,
  apiTokens,
  agentActions,
  agentActionChanges,
  inboundAddresses,
  inboundReceipts,
  savedSourceSearches,
  folders,
  feeds,
  articles,
  tags,
  articleTags,
  rules,
  ruleLogs,
  brewConfigs,
  brews,
  settings,
};

export type Feed = typeof feeds.$inferSelect;
