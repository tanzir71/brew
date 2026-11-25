import type { BrewConfigDraft, BrewSection, BrewSchedule } from './types/brew.js';
import type {
  BrewConfigDraft as LegacyDraft,
  BrewSection as LegacySection,
} from './types/legacy-brew.js';
import type { RuleCondition } from './types/rules.js';

export const defaultDelivery = () => ({ web: true as const, feed: false, publicCopy: false });
export function newBrewSection(id: string, kind: BrewSection['kind'] = 'items'): BrewSection {
  return {
    id,
    kind,
    title: kind === 'items' ? 'New section' : kind === 'note' ? 'Note' : 'Divider',
    sources: kind === 'items' ? [{ kind: 'today' }] : [],
    maxItems: 5,
    layout: 'magazine',
    depth: 'excerpt',
    images: true,
    onlyUnread: true,
    sort: 'newest',
    ...(kind === 'note' ? { note: '' } : {}),
  };
}
export function scheduleFromCron(cron: string): BrewSchedule {
  const [minute, hour, day, month, week] = cron.trim().split(/\s+/);
  const time = `${String(Number(hour) || 0).padStart(2, '0')}:${String(Number(minute) || 0).padStart(2, '0')}`;
  if (week === '1-5' && day === '*' && month === '*') return { kind: 'weekdays', time };
  if (week && week !== '*' && /^[0-6](,[0-6])*$/.test(week))
    return { kind: 'weekly', days: week.split(',').map(Number), time };
  if (day && /^\d+$/.test(day) && day !== '*' && week === '*')
    return { kind: 'monthly', dayOfMonth: Number(day), time };
  return { kind: 'daily', time };
}
export function scheduleCron(schedule: BrewSchedule): string {
  const [hour, minute] = schedule.time.split(':').map(Number);
  return `${minute} ${hour} ${schedule.kind === 'monthly' ? (schedule.dayOfMonth ?? 1) : '*'} * ${schedule.kind === 'weekdays' ? '1-5' : schedule.kind === 'weekly' ? [...new Set(schedule.days ?? [1])].sort().join(',') : '*'}`;
}
export function upgradeLegacySections(sections: LegacySection[]): BrewSection[] {
  const used = new Set(sections.map((section) => section.id));
  return sections.flatMap((section) => {
    const item: BrewSection = {
      id: section.id,
      kind: 'items',
      title: section.title,
      sources: [
        {
          kind: section.source,
          ...(section.sourceId === undefined ? {} : { id: section.sourceId }),
        },
      ],
      maxItems: section.maxItems,
      layout:
        section.layout === 'hero'
          ? 'lead'
          : section.layout === 'list'
            ? 'headlines'
            : section.layout,
      depth: section.layout === 'list' ? 'title' : 'excerpt',
      images: section.layout !== 'list',
      onlyUnread: section.onlyUnread,
      sort: section.sort,
    };
    if (!section.divider) return [item];
    let id = `${section.id}:note`;
    while (used.has(id)) id += ':note';
    used.add(id);
    return [{ ...newBrewSection(id, 'note'), note: section.divider }, item];
  });
}
export function upgradeLegacyDraft(draft: LegacyDraft, timezone: string): BrewConfigDraft {
  return {
    name: draft.name,
    enabled: draft.enabled,
    sections: upgradeLegacySections(draft.sections),
    timezone,
    schedule: scheduleFromCron(draft.scheduleCron),
    delivery: defaultDelivery(),
  };
}
export function legacySections(sections: BrewSection[]): LegacySection[] {
  return sections
    .filter((section) => section.kind === 'items')
    .map((section) => {
      const source = section.sources[0] ?? { kind: 'today' as const };
      return {
        id: section.id,
        title: section.title,
        source: ['newsletters', 'saved_search'].includes(source.kind)
          ? 'today'
          : (source.kind as LegacySection['source']),
        ...(source.id === undefined ? {} : { sourceId: source.id }),
        maxItems: section.maxItems,
        layout:
          section.layout === 'lead'
            ? 'hero'
            : section.layout === 'headlines'
              ? 'list'
              : section.layout,
        onlyUnread: section.onlyUnread,
        sort: section.sort === 'oldest' ? 'newest' : section.sort,
      };
    });
}
const fields = new Set(['title', 'content', 'author', 'url', 'feed', 'folder']);
const operators = new Set([
  'contains',
  'not_contains',
  'equals',
  'starts_with',
  'ends_with',
  'matches_regex',
]);
export function validateComposition(value: unknown): asserts value is BrewConfigDraft {
  const draft = value as BrewConfigDraft;
  if (
    !draft ||
    typeof draft.name !== 'string' ||
    !draft.name.trim() ||
    typeof draft.enabled !== 'boolean' ||
    !Array.isArray(draft.sections)
  )
    throw new Error('Brew name and sections are required.');
  validateBrewSchedule(draft.schedule, draft.timezone);
  if (
    !draft.delivery ||
    draft.delivery.web !== true ||
    typeof draft.delivery.feed !== 'boolean' ||
    typeof draft.delivery.publicCopy !== 'boolean'
  )
    throw new Error('Choose delivery channels.');
  if (draft.delivery.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.delivery.email.to))
    throw new Error('Enter a valid delivery email.');
  if (draft.delivery.webhook) {
    try {
      if (!['http:', 'https:'].includes(new URL(draft.delivery.webhook.url).protocol))
        throw new Error();
    } catch {
      throw new Error('Enter an HTTP webhook URL.');
    }
  }
  const ids = new Set<string>();
  for (const section of draft.sections) {
    if (!section || typeof section.id !== 'string' || !section.id || ids.has(section.id))
      throw new Error('Sections need unique IDs.');
    ids.add(section.id);
    if (
      typeof section.title !== 'string' ||
      !section.title.trim() ||
      !['items', 'note', 'divider'].includes(section.kind)
    )
      throw new Error('Each section needs a title and kind.');
    if (
      !['lead', 'magazine', 'grid', 'headlines'].includes(section.layout) ||
      !['title', 'excerpt', 'full', 'brief'].includes(section.depth) ||
      !['newest', 'oldest', 'longest'].includes(section.sort)
    )
      throw new Error('Choose a section layout, depth and order.');
    if (
      typeof section.images !== 'boolean' ||
      typeof section.onlyUnread !== 'boolean' ||
      !Number.isInteger(section.maxItems) ||
      section.maxItems < 1 ||
      section.maxItems > 20
    )
      throw new Error('Section size must be 1–20.');
    if (!Array.isArray(section.sources) || (section.kind === 'items' && !section.sources.length))
      throw new Error('Choose a section source.');
    for (const source of section.sources) {
      if (
        !source ||
        ![
          'folder',
          'feed',
          'tag',
          'starred',
          'featured',
          'today',
          'weekly_review',
          'newsletters',
          'saved_search',
        ].includes(source.kind)
      )
        throw new Error('Choose a valid source.');
      if (
        ['folder', 'feed', 'tag', 'saved_search'].includes(source.kind) &&
        (!Number.isSafeInteger(source.id) || source.id! < 1)
      )
        throw new Error('Choose a source from your library.');
    }
    if (
      section.days &&
      (!Array.isArray(section.days) ||
        section.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6))
    )
      throw new Error('Choose valid section days.');
    if (section.note !== undefined && typeof section.note !== 'string')
      throw new Error('Note must be Markdown text.');
    if (section.filter) {
      if (
        !['all', 'any'].includes(section.filter.match) ||
        !Array.isArray(section.filter.conditions)
      )
        throw new Error('Choose all or any filter conditions.');
      for (const condition of section.filter.conditions as RuleCondition[])
        if (
          !condition ||
          !fields.has(condition.field) ||
          !operators.has(condition.operator) ||
          typeof condition.value !== 'string'
        )
          throw new Error('Choose a filter field, operator and value.');
    }
  }
}

export const BREW_RETENTION_DAYS = 30;
export function validateBrewSchedule(schedule: BrewSchedule, timezone: string) {
  if (typeof timezone !== 'string' || /^[+-]/.test(timezone))
    throw new Error('Choose an IANA time zone.');
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
  } catch {
    throw new Error('Choose an IANA time zone.');
  }
  if (
    !schedule ||
    !['daily', 'weekdays', 'weekly', 'monthly'].includes(schedule.kind) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)
  )
    throw new Error('Choose a valid schedule and time.');
  if (
    schedule.kind === 'weekly' &&
    (!Array.isArray(schedule.days) ||
      !schedule.days.length ||
      schedule.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6))
  )
    throw new Error('Choose a weekday.');
  if (
    schedule.kind === 'monthly' &&
    (!Number.isInteger(schedule.dayOfMonth) ||
      schedule.dayOfMonth! < 1 ||
      schedule.dayOfMonth! > 31)
  )
    throw new Error('Choose a day from 1–31.');
  if (
    schedule.skipIfFewerThan !== undefined &&
    (!Number.isSafeInteger(schedule.skipIfFewerThan) || schedule.skipIfFewerThan < 0)
  )
    throw new Error('The skip threshold must be a non-negative whole number.');
}
