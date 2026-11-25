CREATE TABLE inbound_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL UNIQUE,
  mechanism TEXT NOT NULL CHECK (mechanism IN ('imap','webhook','cloudflare-email','email-to-feed')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE inbound_receipts (
  key TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX inbound_receipts_expiry ON inbound_receipts(expires_at);
