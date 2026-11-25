import { upgradeLegacyDraft } from '../../core/src/composition-model.js';
import type { BrewSection } from '../../core/src/types/legacy-brew.js';

/** Portable data step paired with 0006; targets apply it in the DDL transaction. */
export function migrateLegacyBrewRow(
  row: { name: string; enabled: number | boolean; schedule_cron: string; sections_json: string },
  timezone: string,
) {
  const draft = upgradeLegacyDraft(
    {
      name: row.name,
      enabled: !!row.enabled,
      scheduleCron: row.schedule_cron,
      sections: JSON.parse(row.sections_json) as BrewSection[],
    },
    timezone,
  );
  return {
    timezone: draft.timezone,
    scheduleJson: JSON.stringify(draft.schedule),
    deliveryJson: JSON.stringify(draft.delivery),
    sectionsJson: JSON.stringify(draft.sections),
  };
}
