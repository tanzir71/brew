import { expect, it } from 'vitest';
import type { Capabilities } from '@brew/core/types/capabilities';
import { capabilityRows } from './capabilityRows';

const capabilities: Capabilities = {
  mode: 'node',
  fetch: 'direct',
  backgroundFetch: { kind: 'always' },
  inboundMail: null,
  emailDelivery: null,
  readerApi: false,
  mcp: null,
  webmcp: false,
  ai: { available: [], configured: false },
  readState: 'server',
  publicCopy: false,
};
it('renders all features while checking or when capabilities fail', () => {
  expect(capabilityRows()).toHaveLength(7);
  expect(
    capabilityRows(undefined, true).every(
      (row) => row.label === 'Unavailable' && row.tone === 'neutral' && row.setup === undefined,
    ),
  ).toBe(true);
});
it('uses feature fields for availability regardless of the runtime name', () => {
  expect(capabilityRows({ ...capabilities, mode: 'browser' })).toEqual(
    capabilityRows(capabilities),
  );
  const local = capabilityRows({ ...capabilities, readState: 'local', fetch: 'relay' });
  expect(local.find((row) => row.id === 'fetch')).toMatchObject({
    label: 'Needs relay',
    setup: 'Set up',
  });
  expect(
    capabilityRows({ ...capabilities, fetch: 'relay', fetchConfigured: true }).find(
      (row) => row.id === 'fetch',
    ),
  ).toMatchObject({ label: 'Works here', setup: 'Set up' });
  expect(local.find((row) => row.id === 'delivery')).toMatchObject({
    tone: 'locked',
    label: 'Server modes',
    setup: 'Set up',
  });
  const enabled = capabilityRows({
    ...capabilities,
    mode: 'browser',
    emailDelivery: 'smtp',
    readerApi: true,
    mcp: 'http',
    publicCopy: true,
    ai: { available: ['byo'], configured: true },
  });
  for (const id of ['delivery', 'apps', 'agents', 'data', 'briefs'])
    expect(enabled.find((row) => row.id === id)).toMatchObject({
      tone: 'positive',
      label: 'Works here',
    });
});
it('keeps mail and model setup visible and describes published copies as read-only', () => {
  const rows = capabilityRows(capabilities);
  expect(rows.find((row) => row.id === 'delivery')).toMatchObject({
    label: 'Needs mail add-on',
    setup: 'Set up',
  });
  expect(rows.find((row) => row.id === 'briefs')).toMatchObject({
    label: 'Needs a model',
    setup: 'Choose',
  });
  const published = capabilityRows({
    ...capabilities,
    fetch: 'build-time',
    backgroundFetch: { kind: 'build-time' },
    readState: 'local',
  });
  expect(published.find((row) => row.id === 'fetch')).toMatchObject({
    tone: 'neutral',
    label: 'Read-only',
  });
});
