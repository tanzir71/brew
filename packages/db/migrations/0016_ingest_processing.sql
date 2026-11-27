CREATE TABLE ingest_jobs (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  state_json TEXT NOT NULL DEFAULT '{"phase":"duplicates"}',
  version INTEGER NOT NULL DEFAULT 0,
  runner TEXT,
  expires_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX ingest_jobs_ready ON ingest_jobs(expires_at,sequence);
CREATE UNIQUE INDEX ingest_jobs_runner ON ingest_jobs(runner);
CREATE TABLE ingest_job_items (
  article_id INTEGER PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES ingest_jobs(id) ON DELETE CASCADE
);
CREATE INDEX ingest_job_items_job ON ingest_job_items(job_id,article_id);
-- Exists only inside one atomic checkpoint. A failed fence aborts its effects.
CREATE TABLE ingest_job_guard (
  id INTEGER PRIMARY KEY CONSTRAINT ingest_guard_id CHECK(id=1),
  valid INTEGER NOT NULL CONSTRAINT brew_ingest_lease CHECK(valid=1)
);

CREATE TRIGGER IF NOT EXISTS "brew_persistent_action_ingest_jobs_INSERT" AFTER INSERT ON main."ingest_jobs" WHEN json_extract((SELECT value FROM settings WHERE key='brew_active_action'),'$.id') IS NOT NULL   BEGIN
          INSERT INTO agent_action_changes(action_id,table_name,key_json,before_json,after_json)
          VALUES(json_extract((SELECT value FROM settings WHERE key='brew_active_action'),'$.id'),'ingest_jobs',json_object('sequence',NEW."sequence"),NULL,json_object('sequence',NEW."sequence",'id',NEW."id",'feed_id',NEW."feed_id",'state_json',NEW."state_json",'version',NEW."version",'runner',NEW."runner",'expires_at',NEW."expires_at",'created_at',NEW."created_at"));  END;

CREATE TRIGGER IF NOT EXISTS "brew_persistent_action_ingest_jobs_UPDATE" AFTER UPDATE ON main."ingest_jobs" WHEN json_extract((SELECT value FROM settings WHERE key='brew_active_action'),'$.id') IS NOT NULL  AND (OLD."sequence" IS NOT NEW."sequence" OR OLD."id" IS NOT NEW."id" OR OLD."feed_id" IS NOT NEW."feed_id" OR OLD."state_json" IS NOT NEW."state_json" OR OLD."version" IS NOT NEW."version" OR OLD."runner" IS NOT NEW."runner" OR OLD."expires_at" IS NOT NEW."expires_at" OR OLD."created_at" IS NOT NEW."created_at") BEGIN
          INSERT INTO agent_action_changes(action_id,table_name,key_json,before_json,after_json)
          VALUES(json_extract((SELECT value FROM settings WHERE key='brew_active_action'),'$.id'),'ingest_jobs',json_object('sequence',NEW."sequence"),(SELECT json_group_object(json_extract(entry.value,'$.name'),json_extract(entry.value,'$.value')) FROM json_each(json_array(json_array(CASE WHEN OLD."sequence" IS NOT NEW."sequence" THEN json_object('name','sequence','value',OLD."sequence") END,CASE WHEN OLD."id" IS NOT NEW."id" THEN json_object('name','id','value',OLD."id") END,CASE WHEN OLD."feed_id" IS NOT NEW."feed_id" THEN json_object('name','feed_id','value',OLD."feed_id") END,CASE WHEN OLD."state_json" IS NOT NEW."state_json" THEN json_object('name','state_json','value',OLD."state_json") END,CASE WHEN OLD."version" IS NOT NEW."version" THEN json_object('name','version','value',OLD."version") END,CASE WHEN OLD."runner" IS NOT NEW."runner" THEN json_object('name','runner','value',OLD."runner") END,CASE WHEN OLD."expires_at" IS NOT NEW."expires_at" THEN json_object('name','expires_at','value',OLD."expires_at") END,CASE WHEN OLD."created_at" IS NOT NEW."created_at" THEN json_object('name','created_at','value',OLD."created_at") END))) blocks JOIN json_each(blocks.value) entry WHERE entry.type='object'),(SELECT json_group_object(json_extract(entry.value,'$.name'),json_extract(entry.value,'$.value')) FROM json_each(json_array(json_array(CASE WHEN OLD."sequence" IS NOT NEW."sequence" THEN json_object('name','sequence','value',NEW."sequence") END,CASE WHEN OLD."id" IS NOT NEW."id" THEN json_object('name','id','value',NEW."id") END,CASE WHEN OLD."feed_id" IS NOT NEW."feed_id" THEN json_object('name','feed_id','value',NEW."feed_id") END,CASE WHEN OLD."state_json" IS NOT NEW."state_json" THEN json_object('name','state_json','value',NEW."state_json") END,CASE WHEN OLD."version" IS NOT NEW."version" THEN json_object('name','version','value',NEW."version") END,CASE WHEN OLD."runner" IS NOT NEW."runner" THEN json_object('name','runner','value',NEW."runner") END,CASE WHEN OLD."expires_at" IS NOT NEW."expires_at" THEN json_object('name','expires_at','value',NEW."expires_at") END,CASE WHEN OLD."created_at" IS NOT NEW."created_at" THEN json_object('name','created_at','value',NEW."created_at") END))) blocks JOIN json_each(blocks.value) entry WHERE entry.type='object'));  END;

CREATE TRIGGER IF NOT EXISTS "brew_persistent_action_ingest_jobs_DELETE" AFTER DELETE ON main."ingest_jobs" WHEN json_extract((SELECT value FROM settings WHERE key='brew_active_action'),'$.id') IS NOT NULL   BEGIN
          INSERT INTO agent_action_changes(action_id,table_name,key_json,before_json,after_json)
          VALUES(json_extract((SELECT value FROM settings WHERE key='brew_active_action'),'$.id'),'ingest_jobs',json_object('sequence',OLD."sequence"),json_object('sequence',OLD."sequence",'id',OLD."id",'feed_id',OLD."feed_id",'state_json',OLD."state_json",'version',OLD."version",'runner',OLD."runner",'expires_at',OLD."expires_at",'created_at',OLD."created_at"),NULL);  END;

CREATE TRIGGER IF NOT EXISTS "brew_persistent_action_ingest_job_items_INSERT" AFTER INSERT ON main."ingest_job_items" WHEN json_extract((SELECT value FROM settings WHERE key='brew_active_action'),'$.id') IS NOT NULL   BEGIN
          INSERT INTO agent_action_changes(action_id,table_name,key_json,before_json,after_json)
          VALUES(json_extract((SELECT value FROM settings WHERE key='brew_active_action'),'$.id'),'ingest_job_items',json_object('article_id',NEW."article_id"),NULL,json_object('article_id',NEW."article_id",'job_id',NEW."job_id"));  END;

CREATE TRIGGER IF NOT EXISTS "brew_persistent_action_ingest_job_items_UPDATE" AFTER UPDATE ON main."ingest_job_items" WHEN json_extract((SELECT value FROM settings WHERE key='brew_active_action'),'$.id') IS NOT NULL  AND (OLD."article_id" IS NOT NEW."article_id" OR OLD."job_id" IS NOT NEW."job_id") BEGIN
          INSERT INTO agent_action_changes(action_id,table_name,key_json,before_json,after_json)
          VALUES(json_extract((SELECT value FROM settings WHERE key='brew_active_action'),'$.id'),'ingest_job_items',json_object('article_id',NEW."article_id"),(SELECT json_group_object(json_extract(entry.value,'$.name'),json_extract(entry.value,'$.value')) FROM json_each(json_array(json_array(CASE WHEN OLD."article_id" IS NOT NEW."article_id" THEN json_object('name','article_id','value',OLD."article_id") END,CASE WHEN OLD."job_id" IS NOT NEW."job_id" THEN json_object('name','job_id','value',OLD."job_id") END))) blocks JOIN json_each(blocks.value) entry WHERE entry.type='object'),(SELECT json_group_object(json_extract(entry.value,'$.name'),json_extract(entry.value,'$.value')) FROM json_each(json_array(json_array(CASE WHEN OLD."article_id" IS NOT NEW."article_id" THEN json_object('name','article_id','value',NEW."article_id") END,CASE WHEN OLD."job_id" IS NOT NEW."job_id" THEN json_object('name','job_id','value',NEW."job_id") END))) blocks JOIN json_each(blocks.value) entry WHERE entry.type='object'));  END;

CREATE TRIGGER IF NOT EXISTS "brew_persistent_action_ingest_job_items_DELETE" AFTER DELETE ON main."ingest_job_items" WHEN json_extract((SELECT value FROM settings WHERE key='brew_active_action'),'$.id') IS NOT NULL   BEGIN
          INSERT INTO agent_action_changes(action_id,table_name,key_json,before_json,after_json)
          VALUES(json_extract((SELECT value FROM settings WHERE key='brew_active_action'),'$.id'),'ingest_job_items',json_object('article_id',OLD."article_id"),json_object('article_id',OLD."article_id",'job_id',OLD."job_id"),NULL); UPDATE ingest_jobs SET runner=NULL,expires_at=(SELECT created_at+30000 FROM agent_actions WHERE id=json_extract((SELECT value FROM settings WHERE key='brew_active_action'),'$.id')),version=version+1 WHERE id=OLD.job_id; END;
