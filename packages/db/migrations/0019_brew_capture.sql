CREATE TABLE brew_schedule_captures (
  slot INTEGER PRIMARY KEY CONSTRAINT brew_schedule_capture_slot CHECK(slot=1),
  id TEXT NOT NULL UNIQUE,
  after_at INTEGER NOT NULL,
  through_at INTEGER NOT NULL,
  current_at INTEGER NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0,
  initialized INTEGER NOT NULL DEFAULT 0,
  runner TEXT,
  expires_at INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE brew_schedule_configs (
  capture_id TEXT NOT NULL REFERENCES brew_schedule_captures(id) ON DELETE CASCADE,
  config_id INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  PRIMARY KEY(capture_id,config_id)
) WITHOUT ROWID;

-- Older bundles enqueue without a discovery fence. While this window exists,
-- only its atomic fenced pages may admit occurrences or advance the watermark.
CREATE TRIGGER brew_schedule_discovery_jobs BEFORE INSERT ON brew_schedule_jobs
WHEN EXISTS(SELECT 1 FROM brew_schedule_captures)
  AND NOT EXISTS(SELECT 1 FROM brew_schedule_guard WHERE id=1 AND valid=1)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER brew_schedule_discovery_watermark_insert BEFORE INSERT ON settings
WHEN NEW.key='brew:schedule:through' AND EXISTS(SELECT 1 FROM brew_schedule_captures)
  AND NOT EXISTS(SELECT 1 FROM brew_schedule_guard WHERE id=1 AND valid=1)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER brew_schedule_discovery_watermark_update BEFORE UPDATE ON settings
WHEN NEW.key='brew:schedule:through' AND EXISTS(SELECT 1 FROM brew_schedule_captures)
  AND NOT EXISTS(SELECT 1 FROM brew_schedule_guard WHERE id=1 AND valid=1)
BEGIN SELECT RAISE(IGNORE); END;
