import type { ScheduledCapture } from '../../core/src/brew-scheduled-capture.js';
import type { ScheduledBrewRequest } from '../../core/src/brew-scheduled-request.js';
import type { SqlQuery } from './reader-queries.js';
import { brewConfigFromRaw } from './brew-queries.js';
import {
  scheduledConfig,
  scheduledRequestQueries,
  scheduledWatermark,
  clearScheduleFence,
} from './brew-scheduled-queries.js';

const fields = [
  'id',
  'name',
  'schedule_cron',
  'enabled',
  'sections_json',
  'timezone',
  'schedule_json',
  'delivery_json',
  'legacy_sections_json',
  'composition_version',
  'created_at',
];
export function beginScheduledCapture(
  runner: string,
  now: number,
  until: number,
  pendingOnly = false,
): SqlQuery[] {
  return [
    {
      sql: `INSERT INTO brew_schedule_captures(slot,id,after_at,through_at,current_at)
      SELECT 1,?,a,min(?,a+86400000),? FROM
      (SELECT min(CASE WHEN json_valid(value) THEN CASE WHEN json_type(value) IN ('integer','real')
        AND CAST(value AS REAL) BETWEEN -9007199254740991 AND 9007199254740991
        AND CAST(value AS REAL)=CAST(CAST(value AS REAL) AS INTEGER)
        THEN CAST(CAST(value AS REAL) AS INTEGER) ELSE ?-60000 END ELSE ?-60000 END,?-60000) AS a
        FROM settings WHERE key='brew:schedule:through') WHERE ?=0
      ON CONFLICT(slot) DO NOTHING`,
      values: [runner, now, now, now, now, now, pendingOnly ? 1 : 0],
    },
    {
      sql: `INSERT INTO brew_schedule_configs(capture_id,config_id,snapshot_json)
      SELECT cap.id,c.id,json_object(${fields.map((name) => `'${name}',c.${name}`).join(',')})
      FROM brew_schedule_captures cap CROSS JOIN brew_configs c WHERE cap.initialized=0`,
      values: [],
    },
    { sql: 'UPDATE brew_schedule_captures SET initialized=1 WHERE initialized=0', values: [] },
    {
      sql: 'UPDATE brew_schedule_captures SET runner=?,expires_at=? WHERE expires_at<=?',
      values: [runner, until, now],
    },
    {
      sql: 'SELECT id,runner,version,after_at AS after,through_at AS through,current_at AS current,cursor FROM brew_schedule_captures WHERE runner=?',
      values: [runner],
    },
  ];
}
/** Persist before snapshot materialization so a failed first capture cannot lose its minute. */
export function scheduledCaptureAnchor(now: number): SqlQuery {
  return {
    sql: "INSERT OR IGNORE INTO settings(key,value) VALUES('brew:schedule:through',?)",
    values: [String(now - 60_000)],
  };
}
export function captureFence(capture: ScheduledCapture, now: number): SqlQuery {
  return {
    sql: `INSERT INTO brew_schedule_guard(id,valid) SELECT 1,EXISTS(SELECT 1 FROM brew_schedule_captures
    WHERE id=? AND runner=? AND version=? AND expires_at>? AND initialized=1)`,
    values: [capture.id, capture.runner, capture.version, now],
  };
}
export function scheduledConfigPage(
  capture: ScheduledCapture,
  limit: number,
  now: number,
): SqlQuery[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error('Invalid configuration page size.');
  return [
    captureFence(capture, now),
    {
      sql: 'SELECT snapshot_json FROM brew_schedule_configs WHERE capture_id=? AND config_id>? ORDER BY config_id LIMIT ?',
      values: [capture.id, capture.cursor, limit],
    },
    clearScheduleFence,
  ];
}
export function capturedConfigs(rows: { snapshot_json: string }[]) {
  return rows.map((row) => scheduledConfig(brewConfigFromRaw(JSON.parse(row.snapshot_json))));
}
export function commitScheduledCapture(
  capture: ScheduledCapture,
  cursor: number | null,
  requests: ScheduledBrewRequest[],
  now: number,
  until: number,
): SqlQuery[] {
  return [
    captureFence(capture, now),
    ...scheduledRequestQueries(requests, capture.current),
    ...(cursor === null
      ? [
          scheduledWatermark(capture.through),
          { sql: 'DELETE FROM brew_schedule_captures WHERE id=?', values: [capture.id] },
        ]
      : [
          {
            sql: 'UPDATE brew_schedule_captures SET cursor=?,expires_at=?,version=version+1 WHERE id=?',
            values: [cursor, until, capture.id],
          },
        ]),
    clearScheduleFence,
  ];
}
export function releaseScheduledCapture(capture: ScheduledCapture): SqlQuery {
  return {
    sql: 'UPDATE brew_schedule_captures SET runner=NULL,expires_at=0 WHERE id=? AND runner=?',
    values: [capture.id, capture.runner],
  };
}
