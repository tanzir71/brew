import { nextBrewAt } from './brew-schedule.js';
import type { BrewConfig } from './types/brew.js';
import type { BrewConfig as LegacyConfig } from './types/legacy-brew.js';
export type ScheduledConfig =
  { kind: 'legacy'; config: LegacyConfig } | { kind: 'composition'; config: BrewConfig };
export type ScheduledBrewRequest = ScheduledConfig & { receipt: { key: string; value: string } };
export function legacyScheduleReceipt(config: LegacyConfig, now: Date) {
  if (!config.enabled) return null;
  const [minute, hour] = config.scheduleCron.trim().split(/\s+/);
  return minute === String(now.getMinutes()) && hour === String(now.getHours())
    ? {
        key: `brew_generated_${config.id}_${now.toISOString().slice(0, 10)}`,
        value: now.toISOString(),
      }
    : null;
}
export function compositionScheduleReceipt(config: BrewConfig, now: Date) {
  if (!config.enabled) return null;
  const scheduled = nextBrewAt(config.schedule, config.timezone, new Date(now.getTime() - 60_000));
  return scheduled.getTime() > now.getTime()
    ? null
    : {
        key: `brew_composed_${config.id}_${scheduled.toISOString()}`,
        value: scheduled.toISOString(),
      };
}
export function scheduledBrewRequest(
  value: ScheduledConfig,
  now: Date,
): ScheduledBrewRequest | null {
  const receipt =
    value.kind === 'legacy'
      ? legacyScheduleReceipt(value.config, now)
      : compositionScheduleReceipt(value.config, now);
  return receipt ? { ...value, receipt } : null;
}
/** Discover up to one day's occurrences; the caller persists the through time
 * atomically with these requests. Current-minute overlap admits new Brews.
 */
export function scheduledBrewRequests(
  value: ScheduledConfig,
  after: Date,
  through: Date,
): ScheduledBrewRequest[] {
  const result: ScheduledBrewRequest[] = [];
  if (!value.config.enabled) return result;
  let cursor = after;
  while (true) {
    let next: Date;
    if (value.kind === 'composition')
      next = nextBrewAt(value.config.schedule, value.config.timezone, cursor);
    else {
      const [minute, hour] = value.config.scheduleCron.trim().split(/\s+/).map(Number);
      next = new Date(cursor);
      next.setHours(hour!, minute!, 0, 0);
      if (next.getTime() <= cursor.getTime()) next.setDate(next.getDate() + 1);
    }
    if (!Number.isFinite(next.getTime()) || next.getTime() <= cursor.getTime())
      throw new Error('Invalid scheduled Brew time.');
    if (next.getTime() > through.getTime()) return result;
    const request = scheduledBrewRequest(value, next);
    if (request) result.push(request);
    cursor = next;
  }
}
