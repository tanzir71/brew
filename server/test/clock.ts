import { afterEach, beforeEach, expect, vi } from 'vitest';

// The unchanged v1 corpus is dated July 10. Freeze wall time so retention tests
// exercise the same records regardless of the date the suite is run.
beforeEach(() => {
  if (expect.getState().testPath?.replaceAll('\\', '/').includes('/server/'))
    vi.setSystemTime(new Date('2026-07-10T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());
