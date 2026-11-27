export const agentTokenColumns = 'id,name,scopes,expires_at,last_used_at,created_at';
export const listAgentTokens = `SELECT ${agentTokenColumns} FROM api_tokens ORDER BY id DESC`;
// Enforce the cap in the insert itself, including simultaneous invocations.
export const insertAgentToken = `INSERT INTO api_tokens(name,token_hash,scopes,expires_at,created_at) SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM api_tokens)<100 RETURNING ${agentTokenColumns}`;
// Checking the live grant and recording use are one statement, fenced against revocation.
export const authenticateAgentToken = `UPDATE api_tokens SET last_used_at=? WHERE token_hash=? AND expires_at>? RETURNING ${agentTokenColumns}`;
export const currentAgentToken = `UPDATE api_tokens SET last_used_at=? WHERE id=? AND expires_at>? RETURNING ${agentTokenColumns}`;
export const insertAgentActivity =
  'INSERT INTO agent_actions(token_id,agent,tool,args_json,result_json,created_at) VALUES(?,?,?,?,?,?)';
export const listAgentActivity =
  "SELECT id,agent,tool,result_json,undo_json,undone_at,created_at FROM agent_actions WHERE (token_id IS NOT NULL OR agent IN ('mcp','WebMCP','webmcp','reader','Reader sync')) AND id<? ORDER BY id DESC LIMIT 21";
