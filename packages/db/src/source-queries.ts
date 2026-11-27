export const sourceSearchesQuery =
  'SELECT id,client_id AS clientId,name,query FROM saved_source_searches ORDER BY name,id';
export const saveSourceSearchQuery =
  'INSERT INTO saved_source_searches(client_id,name,query) VALUES(?,?,?) ON CONFLICT(client_id) DO UPDATE SET name=excluded.name,query=excluded.query RETURNING id,client_id AS clientId,name,query';
export const mailboxTableQuery =
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name='inbound_addresses'";
export const sourceMailboxQuery =
  'SELECT address FROM inbound_addresses WHERE active=1 ORDER BY id LIMIT 1';
