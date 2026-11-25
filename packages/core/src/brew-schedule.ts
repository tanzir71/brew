import { Temporal } from '@js-temporal/polyfill';
import type { BrewSchedule } from './types/brew.js';

// Compatible disambiguation follows Temporal/iCalendar across clock changes.
export function nextBrewAt(schedule: BrewSchedule, timezone: string, after: Date): Date {
  const instant = Temporal.Instant.from(after.toISOString());
  const local = instant.toZonedDateTimeISO(timezone);
  const time = Temporal.PlainTime.from(schedule.time);
  for (let offset = 0; offset <= 370; offset++) {
    const date = local.toPlainDate().add({ days: offset });
    const weekday = date.dayOfWeek % 7;
    if (schedule.kind === 'weekdays' && (weekday === 0 || weekday === 6)) continue;
    if (schedule.kind === 'weekly' && !schedule.days?.includes(weekday)) continue;
    if (schedule.kind === 'monthly' && date.day !== schedule.dayOfMonth) continue;
    const candidate = date
      .toPlainDateTime(time)
      .toZonedDateTime(timezone, { disambiguation: 'compatible' })
      .toInstant();
    if (Temporal.Instant.compare(candidate, instant) > 0)
      return new Date(candidate.epochMilliseconds);
  }
  throw new Error('Could not find the next scheduled Brew.');
}
export function weekdayAt(at: Date, timezone: string): number {
  return Temporal.Instant.from(at.toISOString()).toZonedDateTimeISO(timezone).dayOfWeek % 7;
}
