import { sql } from 'drizzle-orm';
import {
  index,
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
    kind: text('kind', { enum: ['rss', 'newsletter'] }).notNull().default('rss'),
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

export const schema = {
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
