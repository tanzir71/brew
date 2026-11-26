CREATE TABLE agent_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id INTEGER,
  request_id TEXT UNIQUE,
  agent TEXT NOT NULL,
  tool TEXT NOT NULL,
  args_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  undo_json TEXT,
  created_at INTEGER NOT NULL,
  undone_at INTEGER
);
CREATE TABLE agent_action_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id INTEGER NOT NULL REFERENCES agent_actions(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  key_json TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT
);
CREATE INDEX agent_action_changes_action ON agent_action_changes(action_id, id);
CREATE INDEX agent_actions_created ON agent_actions(created_at);
