ALTER TABLE articles ADD COLUMN highlight_color TEXT;
ALTER TABLE articles ADD COLUMN featured_in_brew INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN excluded_from_brew INTEGER NOT NULL DEFAULT 0;
