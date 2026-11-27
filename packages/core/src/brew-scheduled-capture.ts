import { scheduledBrewRequests, type ScheduledConfig } from './brew-scheduled-request.js';

/** One immutable discovery window, resumed independently of issue generation. */
export interface ScheduledCapture {
  id: string;
  runner: string;
  version: number;
  after: number;
  through: number;
  current: number;
  cursor: number;
}
export function capturedScheduleRequests(value: ScheduledConfig, capture: ScheduledCapture) {
  const created = Date.parse(value.config.createdAt);
  const start =
    Number.isFinite(created) && created <= capture.current
      ? Math.max(capture.after, Math.floor(created / 60_000) * 60_000 - 1)
      : capture.after;
  const requests = scheduledBrewRequests(value, new Date(start), new Date(capture.through));
  if (capture.through < capture.current)
    requests.push(
      ...scheduledBrewRequests(
        value,
        new Date(Math.max(start, capture.current - 60_000)),
        new Date(capture.current),
      ),
    );
  return [...new Map(requests.map((request) => [request.receipt.key, request])).values()];
}
