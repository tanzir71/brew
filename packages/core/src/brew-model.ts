import type { BrewConfig, BrewConfigDraft, BrewSection, BrewItem } from './types/legacy-brew.js';
import type { BrewConfig as Composition } from './types/brew.js';
import type { BrewItemQuery, BrewItemRow } from './ports.js';
import { nextBrewAt } from './brew-schedule.js';

export function validateLegacyBrew(draft: BrewConfigDraft): void {
  if (!draft.name.trim()) throw new Error('Brew name is required');
  for (const section of draft.sections) {
    if (section.maxItems < 1 || section.maxItems > 20) throw new Error('Section size must be 1–20');
    if (['folder', 'feed', 'tag'].includes(section.source) && !section.sourceId)
      throw new Error('Choose a section source');
  }
}

export function legacyBrewQuery(section: BrewSection, now: Date): BrewItemQuery {
  return {
    onlyUnread: section.onlyUnread,
    folderId: section.source === 'folder' ? section.sourceId : undefined,
    feedId: section.source === 'feed' ? section.sourceId : undefined,
    tagId: section.source === 'tag' ? section.sourceId : undefined,
    starred: section.source === 'starred' || section.source === 'weekly_review',
    featured: section.source === 'featured',
    publishedSince:
      section.source === 'today'
        ? now.getTime() - 86_400_000
        : section.source === 'weekly_review'
          ? now.getTime() - 7 * 86_400_000
          : undefined,
    sort: section.sort,
    limit: section.maxItems,
  };
}

export function legacyBrewItems(rows: BrewItemRow[]): BrewItem[] {
  return rows.map(({ body, ...row }) => ({
    ...row,
    publishedAt: new Date(row.publishedAt).toISOString(),
    readAt: row.readAt === null ? null : new Date(row.readAt).toISOString(),
    readTimeMinutes: Math.max(
      1,
      Math.ceil((body?.replace(/<[^>]+>/g, '').split(/\s+/).length ?? 0) / 220),
    ),
  }));
}

export function brewReadInfo(
  config: Composition | BrewConfig | undefined,
  now: Date,
  legacyTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
) {
  if (config && 'schedule' in config) {
    return {
      timeZone: config.timezone,
      nextAt: config.enabled
        ? nextBrewAt(config.schedule, config.timezone, now).toISOString()
        : null,
      scheduleLabel: config.enabled
        ? config.schedule.kind === 'weekdays'
          ? 'Weekdays'
          : config.schedule.kind === 'weekly'
            ? 'Weekly'
            : config.schedule.kind === 'monthly'
              ? 'Monthly'
              : 'Daily'
        : 'Schedule paused',
    };
  }
  const [minute, hour] = (config?.scheduleCron ?? '').split(/\s+/).map(Number);
  const next = new Date(now);
  let nextAt: string | null = null;
  if (
    config?.enabled &&
    Number.isInteger(minute) &&
    Number.isInteger(hour) &&
    minute! >= 0 &&
    minute! < 60 &&
    hour! >= 0 &&
    hour! < 24
  ) {
    const now = next.getTime();
    next.setHours(hour!, minute!, 0, 0);
    if (next.getTime() <= now) next.setDate(next.getDate() + 1);
    nextAt = next.toISOString();
  }
  return {
    timeZone: legacyTimezone,
    nextAt,
    scheduleLabel: config?.enabled ? 'Daily' : 'Schedule paused',
  };
}
