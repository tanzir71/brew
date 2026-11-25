PRAGMA foreign_keys = ON;

CREATE TABLE folders (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000));
CREATE TABLE feeds (id INTEGER PRIMARY KEY AUTOINCREMENT, folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL, url TEXT NOT NULL, site_url TEXT, title TEXT NOT NULL, description TEXT, favicon_url TEXT, fetch_interval_minutes INTEGER NOT NULL DEFAULT 30, etag TEXT, last_modified TEXT, last_fetched_at INTEGER, last_status INTEGER, consecutive_failures INTEGER NOT NULL DEFAULT 0, full_text_mode INTEGER NOT NULL DEFAULT 0, muted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000));
CREATE UNIQUE INDEX feeds_url_unique ON feeds(url);
CREATE TABLE articles (id INTEGER PRIMARY KEY AUTOINCREMENT, feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE, guid TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, author TEXT, summary_html TEXT, content_html TEXT, full_text_html TEXT, image_url TEXT, published_at INTEGER NOT NULL, fetched_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000), read_at INTEGER, starred_at INTEGER, hidden INTEGER NOT NULL DEFAULT 0, hash TEXT NOT NULL);
CREATE UNIQUE INDEX articles_feed_guid_unique ON articles(feed_id, guid);
CREATE INDEX articles_feed_published_idx ON articles(feed_id, published_at DESC);
CREATE INDEX articles_read_idx ON articles(read_at);
CREATE INDEX articles_hash_idx ON articles(hash);
CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT NOT NULL);
CREATE UNIQUE INDEX tags_name_unique ON tags(name);
CREATE TABLE article_tags (article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE, tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(article_id, tag_id));
CREATE TABLE rules (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL DEFAULT 0, match_type TEXT NOT NULL CHECK(match_type IN ('all','any')), scope_json TEXT NOT NULL, conditions_json TEXT NOT NULL, actions_json TEXT NOT NULL, stop_processing INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000), updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000));
CREATE TABLE rule_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE, article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE, executed_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000), actions_taken_json TEXT NOT NULL);
CREATE INDEX rule_logs_rule_executed_idx ON rule_logs(rule_id, executed_at);
CREATE TABLE brew_configs (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, schedule_cron TEXT NOT NULL DEFAULT '0 7 * * *', enabled INTEGER NOT NULL DEFAULT 1, sections_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000));
CREATE TABLE brews (id INTEGER PRIMARY KEY AUTOINCREMENT, brew_config_id INTEGER NOT NULL REFERENCES brew_configs(id) ON DELETE CASCADE, generated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000), payload_json TEXT NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
