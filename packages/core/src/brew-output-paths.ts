import type { BrewIssue } from './types/composition.js';

/** Public Read URLs have always used immutable snapshot IDs, including legacy issues. */
export const brewIssuePath = (issue: Pick<BrewIssue, 'id' | 'brewConfigId'>): string =>
  `/b/${issue.brewConfigId}/${issue.id}`;

/** Let hosts forward output requests without intercepting SPA routes or unknown extensions. */
export const isBrewOutputPath = (path: string): boolean =>
  /^\/b\/[^/]+(?:\/[^/]+)?\.(?:md|json|atom)$/.test(path);
