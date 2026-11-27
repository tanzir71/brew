CREATE TABLE brew_schedule_jobs (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  config_id INTEGER NOT NULL REFERENCES brew_configs(id) ON DELETE CASCADE,
  request_json TEXT NOT NULL,
  state_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  runner TEXT,
  expires_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX brew_schedule_jobs_ready ON brew_schedule_jobs(expires_at,sequence);
CREATE UNIQUE INDEX brew_schedule_jobs_runner ON brew_schedule_jobs(runner);
CREATE TABLE brew_schedule_guard (
  id INTEGER PRIMARY KEY CONSTRAINT brew_schedule_guard_id CHECK(id=1),
  valid INTEGER NOT NULL CONSTRAINT brew_schedule_lease CHECK(valid=1)
);
