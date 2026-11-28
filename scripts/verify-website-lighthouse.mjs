import lighthouse from 'lighthouse';
import { chromium } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { serveWebsite } from './lib/website-server.mjs';

const output = path.resolve('test-results/website/lighthouse');
await mkdir(output, { recursive: true });
const server = process.env.BREW_SITE_URL ? null : await serveWebsite();
const url = process.env.BREW_SITE_URL ?? server.origin + '/brew/';
const failures = [];
try {
  for (const mode of ['mobile', 'desktop']) {
    const profile = await mkdtemp(path.join(tmpdir(), 'brew-lighthouse-'));
    const absolute = path.resolve(profile);
    if (
      path.dirname(absolute) !== path.resolve(tmpdir()) ||
      !path.basename(absolute).startsWith('brew-lighthouse-')
    )
      throw new Error('Unexpected audit profile path.');
    let browser;
    try {
      browser = await chromium.launchPersistentContext(profile, {
        headless: true,
        args: ['--remote-debugging-port=0'],
      });
      const port = Number(
        (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0],
      );
      const result = await lighthouse(
        url,
        { port, logLevel: 'error', output: ['json', 'html'] },
        mode === 'desktop'
          ? {
              extends: 'lighthouse:default',
              settings: {
                formFactor: 'desktop',
                screenEmulation: {
                  mobile: false,
                  width: 1440,
                  height: 1000,
                  deviceScaleFactor: 1,
                  disabled: false,
                },
                throttling: {
                  rttMs: 40,
                  throughputKbps: 10240,
                  cpuSlowdownMultiplier: 1,
                  requestLatencyMs: 0,
                  downloadThroughputKbps: 0,
                  uploadThroughputKbps: 0,
                },
              },
            }
          : undefined,
      );
      await writeFile(path.join(output, mode + '.json'), result.report[0]);
      await writeFile(path.join(output, mode + '.html'), result.report[1]);
      const scores = Object.fromEntries(
        Object.entries(result.lhr.categories).map(([key, value]) => [
          key,
          Math.round(value.score * 100),
        ]),
      );
      process.stdout.write(`${mode}: ${JSON.stringify(scores)}\n`);
      for (const [name, score] of Object.entries(scores))
        if (score < 95) failures.push(`${mode} ${name}: ${score}`);
      if (Object.values(scores).some((score) => score < 95))
        process.stdout.write(
          JSON.stringify(
            Object.values(result.lhr.audits)
              .filter(
                (audit) =>
                  audit.score !== null &&
                  audit.score < 1 &&
                  audit.scoreDisplayMode !== 'informative',
              )
              .map((audit) => ({ id: audit.id, score: audit.score, title: audit.title })),
            null,
            2,
          ) + '\n',
        );
    } finally {
      if (browser) await browser.close();
      await rm(absolute, { recursive: true, force: true, maxRetries: 3 });
    }
  }
} finally {
  if (server) await server.close();
}
if (failures.length) throw new Error(failures.join('\n'));
