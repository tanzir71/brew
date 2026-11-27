ALTER TABLE brew_schedule_jobs ADD COLUMN source_version INTEGER NOT NULL DEFAULT 1;
CREATE TABLE brew_schedule_candidates (
  job_id TEXT NOT NULL REFERENCES brew_schedule_jobs(id) ON DELETE CASCADE,
  section_index INTEGER NOT NULL,
  article_id INTEGER NOT NULL,
  format INTEGER NOT NULL DEFAULT 1 CONSTRAINT brew_schedule_candidate_format CHECK(format IN (0,1)),
  snapshot_json TEXT NOT NULL,
  PRIMARY KEY(job_id,section_index,article_id)
) WITHOUT ROWID;

-- Preserve every already captured candidate before removing the old inline array.
INSERT INTO brew_schedule_candidates(job_id,section_index,article_id,format,snapshot_json)
SELECT j.id,json_extract(j.state_json,'$.index'),json_extract(entry.value,'$.id'),0,entry.value
FROM brew_schedule_jobs j,json_each(j.state_json,'$.candidates') entry
WHERE json_extract(j.state_json,'$.phase')='composition';
UPDATE brew_schedule_jobs SET state_json=json_set(json_remove(state_json,'$.candidates'),
  '$.selection',json_object('after',0,'eligible',0,'matching',0,'selected',json('[]'),'done',json('false')))
WHERE json_extract(state_json,'$.phase')='composition';
UPDATE brew_schedule_jobs SET runner=NULL,expires_at=0,version=version+1;

-- A previous bundle cannot consume the new cursor after its arrays moved here.
CREATE TRIGGER brew_schedule_source_version BEFORE UPDATE OF runner ON brew_schedule_jobs
WHEN NEW.source_version=1 AND NEW.runner IS NOT NULL AND substr(NEW.runner,1,8)<>'source1:'
BEGIN SELECT RAISE(IGNORE); END;

-- An older in-flight capture may enqueue an initial job after this migration.
CREATE TRIGGER brew_schedule_inline_source AFTER INSERT ON brew_schedule_jobs
WHEN NEW.source_version=1 AND json_extract(NEW.state_json,'$.phase')='composition'
  AND json_type(NEW.state_json,'$.candidates')='array'
BEGIN
  INSERT INTO brew_schedule_candidates(job_id,section_index,article_id,format,snapshot_json)
  SELECT NEW.id,json_extract(NEW.state_json,'$.index'),json_extract(entry.value,'$.id'),0,entry.value
  FROM json_each(NEW.state_json,'$.candidates') entry;
  UPDATE brew_schedule_jobs SET state_json=json_set(json_remove(state_json,'$.candidates'),
    '$.selection',json_object('after',0,'eligible',0,'matching',0,'selected',json('[]'),'done',json('false'))),version=version+1
  WHERE id=NEW.id;
END;
