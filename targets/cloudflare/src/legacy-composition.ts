import { migrateLegacyBrewRow } from '../../../packages/db/src/composition-migration.js';
import { CloudflareStorage } from './storage.js';

/** Data half of canonical migration 0006, also needed for imported v1 databases. */
export async function upgradeLegacyCompositions(storage: CloudflareStorage, timezone = 'UTC') {
  const marker = 'migration:0006:composition-data';
  if (await storage.first('SELECT value FROM settings WHERE key=?', [marker])) return;
  const rows = await storage.all<{
    id: number;
    name: string;
    enabled: number;
    schedule_cron: string;
    sections_json: string;
    timezone: string;
    schedule_json: string;
    delivery_json: string;
  }>(`SELECT id,name,enabled,schedule_cron,sections_json,timezone,schedule_json,delivery_json
      FROM brew_configs WHERE composition_version=1 AND legacy_sections_json=sections_json`);
  const statements = rows.flatMap((row) => {
    const value = migrateLegacyBrewRow(row, timezone);
    return [
      storage.statement(
        `UPDATE brew_configs SET timezone=?,schedule_json=?,delivery_json=?,sections_json=?
       WHERE id=? AND sections_json=? AND composition_version=1
       AND NOT EXISTS(SELECT 1 FROM settings WHERE key=?)`,
        [
          value.timezone,
          value.scheduleJson,
          value.deliveryJson,
          value.sectionsJson,
          row.id,
          row.sections_json,
          marker,
        ],
      ),
    ];
  });
  // Empty legacy sections remain "[]" after conversion, so comparing JSON alone
  // cannot distinguish them on a later boot. Record the data step atomically.
  statements.push(
    storage.statement(
      "INSERT INTO settings(key,value) VALUES(?,'done') ON CONFLICT(key) DO NOTHING",
      [marker],
    ),
  );
  await storage.batch(statements);
}
