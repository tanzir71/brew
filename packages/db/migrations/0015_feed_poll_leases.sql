CREATE TABLE feed_poll_leases (
  feed_id INTEGER PRIMARY KEY REFERENCES feeds(id) ON DELETE CASCADE,
  runner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX feed_poll_leases_expiry ON feed_poll_leases(expires_at);
