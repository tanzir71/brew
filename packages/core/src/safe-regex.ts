import type { RegexPort, RegexResult } from './ports.js';

// Untrusted patterns must always run in a target's interruptible executor.
export function safeRegexTest(
  executor: RegexPort,
  pattern: string,
  value: string,
  timeoutMs = 500,
): Promise<RegexResult> {
  return executor.test(pattern, value, timeoutMs);
}
