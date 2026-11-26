CREATE TABLE reader_access (
  id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL,
  salt TEXT NOT NULL, password_hash TEXT NOT NULL, fever_hash TEXT NOT NULL,
  generation TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE reader_sessions (
  token_hash TEXT PRIMARY KEY, write_hash TEXT NOT NULL UNIQUE, generation TEXT NOT NULL,
  expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX reader_sessions_expiry ON reader_sessions(expires_at);
