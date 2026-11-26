CREATE TABLE api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL CHECK(scopes IN ('read','write')),
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX api_tokens_expiry ON api_tokens(expires_at);
CREATE INDEX agent_actions_agent_id ON agent_actions(agent, id);
