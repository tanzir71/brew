import { createHash } from 'node:crypto';
import type { ClockPort, HashPort, RegexPort } from '../../../../packages/core/src/ports.js';
import { safeRegexTest, safeRegexMany } from '../services/safe-regex.js';

export const nodeClock: ClockPort = { now: () => new Date(), monotonic: () => performance.now() };
export const nodeHash: HashPort = {
  sha1: (value) => createHash('sha1').update(value).digest('hex'),
};
export const nodeRegex: RegexPort = { test: safeRegexTest, testMany: safeRegexMany };
