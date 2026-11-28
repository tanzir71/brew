CREATE TABLE __brew_library_identity (
  id INTEGER PRIMARY KEY CHECK(id=1),
  epoch TEXT NOT NULL CHECK(length(epoch)=32 AND epoch NOT GLOB '*[^0-9a-f]*')
);
INSERT INTO __brew_library_identity(id,epoch) VALUES(1,lower(hex(randomblob(16))));

CREATE TABLE __brew_archive_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('export','import','undo')),
  state TEXT NOT NULL CHECK(state IN ('uploading','ready','complete','undone')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  epoch TEXT NOT NULL,
  manifest_json TEXT,
  counts_json TEXT NOT NULL DEFAULT '{}',
  undo_id TEXT
);
CREATE INDEX __brew_archive_expiry ON __brew_archive_jobs(expires_at);
CREATE TABLE __brew_archive_rows (
  job_id TEXT NOT NULL REFERENCES __brew_archive_jobs(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position>=0),
  data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data)='array'),
  PRIMARY KEY(job_id,table_name,position)
);

CREATE TABLE __brew_archive_check (
  id INTEGER PRIMARY KEY CHECK(id=1),
  expected_epoch TEXT NOT NULL
);
CREATE TRIGGER __brew_archive_check_insert BEFORE INSERT ON __brew_archive_check
WHEN NEW.expected_epoch IS NOT (SELECT epoch FROM __brew_library_identity WHERE id=1)
BEGIN SELECT RAISE(ABORT,'The library was imported. Reopen Brew before changing it.'); END;
CREATE TRIGGER __brew_archive_check_update BEFORE UPDATE ON __brew_archive_check
WHEN NEW.expected_epoch IS NOT (SELECT epoch FROM __brew_library_identity WHERE id=1)
BEGIN SELECT RAISE(ABORT,'The library was imported. Reopen Brew before changing it.'); END;
