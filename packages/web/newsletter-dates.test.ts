import { expect, it } from 'vitest';
import { letterDate } from './src/newsletters/dates';

it('dates archived letters relative to the frozen issue in its own time zone', () => {
  const issue = { at: '2026-11-25T01:00:00Z', timeZone: 'Asia/Dhaka' };
  expect(letterDate('2026-11-25T00:12:00Z', false, issue)).toBe('06:12');
  expect(letterDate('2026-11-24T03:00:00Z', false, issue)).toBe('Yesterday');
});
it('uses calendar days rather than elapsed hours across a daylight-saving transition', () => {
  expect(
    letterDate('2026-11-01T03:45:00Z', false, {
      at: '2026-11-02T04:30:00Z',
      timeZone: 'America/New_York',
    }),
  ).toBe('Yesterday');
});
