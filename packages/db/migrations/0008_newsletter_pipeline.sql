ALTER TABLE feeds ADD COLUMN kind TEXT NOT NULL DEFAULT 'rss' CHECK (kind IN ('rss', 'newsletter'));
ALTER TABLE feeds ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE articles ADD COLUMN raw_html TEXT;
ALTER TABLE articles ADD COLUMN cleaning_json TEXT;
