ALTER TABLE feeds ADD COLUMN retention_days INTEGER NOT NULL DEFAULT 90;
ALTER TABLE articles ADD COLUMN enclosure_url TEXT;
ALTER TABLE articles ADD COLUMN enclosure_type TEXT;
