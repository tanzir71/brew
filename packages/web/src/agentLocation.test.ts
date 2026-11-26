import { expect, it } from 'vitest';
import { agentPageHref } from './agentLocation';

it('carries only a temporary URL opt-in through app navigation, scopes and canonical selection', () => {
  const current = new URL('https://brew.test/all?density=title&agent=1');
  expect(agentPageHref('/b/2/4', current)).toBe('/b/2/4?agent=1');
  expect(agentPageHref('/letters?view=archive&page=2', current)).toBe(
    '/letters?view=archive&page=2&agent=1',
  );
  expect(agentPageHref('/settings/runs#setup-agents', current)).toBe(
    '/settings/runs?agent=1#setup-agents',
  );
  expect(agentPageHref('/search?q=tools&scope=starred', current)).toBe(
    '/search?q=tools&scope=starred&agent=1',
  );
  expect(agentPageHref('/all?agent=0', current)).toBe('/all?agent=0');
  expect(agentPageHref('#setup-agents', current)).toBe('#setup-agents');
  expect(agentPageHref('/all', new URL('https://brew.test/'))).toBe('/all');
});
it('leaves outputs, API endpoints, assets, credentials and other origins unchanged', () => {
  const current = new URL('https://brew.test/?agent=1');
  for (const href of [
    '/all.json?page=2',
    '/b/2.atom',
    '/api/articles',
    '/figma/art.png',
    '/manifest.webmanifest',
    'https://elsewhere.test/all',
    'https://user:password@brew.test/all',
  ])
    expect(agentPageHref(href, current)).toBe(href);
});
