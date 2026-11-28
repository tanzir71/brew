import { it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { createBrewArchive, readBrewArchive, archiveManifest } from './src/archive.js';
import { archiveCrc32, readArchiveZip, writeArchiveZip } from './src/archive-zip.js';

const text = new TextEncoder();
const hash = {
  sha256: async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex'),
};
const metadata = {
  createdAt: '2026-11-28T12:00:00.000Z',
  source: 'node' as const,
  migrations: ['0001_initial.sql'],
};
function database() {
  const db = new Database(':memory:');
  try {
    db.exec(
      "CREATE TABLE sample(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO sample VALUES(1,'Café 東京')",
    );
    return db.serialize();
  } finally {
    db.close();
  }
}
it('uses the standard ZIP CRC and carries independent SQLite bytes and Unicode preferences', async () => {
  expect(archiveCrc32(text.encode('123456789'))).toBe(0xcbf43926);
  const image = database();
  const archive = await createBrewArchive(
    image,
    { ...metadata, preferences: { label: 'Café 東京', theme: 'dark' } },
    hash,
  );
  const prefixed = new Uint8Array(archive.length + 17);
  prefixed.set(archive, 17);
  const result = await readBrewArchive(prefixed.subarray(17), hash);
  expect(result.database).toEqual(new Uint8Array(image));
  expect(result.manifest.preferences).toEqual({ label: 'Café 東京', theme: 'dark' });
  const opened = new Database(Buffer.from(result.database), { readonly: true });
  try {
    expect(opened.prepare('SELECT value FROM sample').get()).toEqual({ value: 'Café 東京' });
  } finally {
    opened.close();
  }
});
it.each([0, 1, 8, 21, -1, -22, -64])('rejects a truncated archive of length %i', async (length) => {
  const archive = await createBrewArchive(database(), metadata, hash);
  await expect(
    readBrewArchive(archive.subarray(0, length < 0 ? archive.length + length : length), hash),
  ).rejects.toThrow();
});
it('rejects changed SQLite bytes even after the ZIP CRC has been recomputed', async () => {
  const files = readArchiveZip(await createBrewArchive(database(), metadata, hash));
  const image = files['library.sqlite'].slice();
  image[image.length - 1] = image[image.length - 1]! ^ 1;
  const changed = writeArchiveZip(files['manifest.json'], image);
  await expect(readBrewArchive(changed, hash)).rejects.toThrow(/database checksum/);
});
it('rejects CRC corruption without needing to open SQLite', async () => {
  const archive = await createBrewArchive(database(), metadata, hash);
  archive[60] = archive[60]! ^ 1;
  expect(() => readArchiveZip(archive)).toThrow(/checksum/);
});
it.each(['encryption', 'compression', 'offset', 'link', 'unclaimed', 'name'])(
  'rejects invalid ZIP metadata: %s',
  async (kind) => {
    const archive = await createBrewArchive(database(), metadata, hash);
    const view = new DataView(archive.buffer);
    const end = archive.length - 22;
    const directory = view.getUint32(end + 16, true);
    if (kind === 'encryption') view.setUint16(directory + 8, 1, true);
    if (kind === 'compression') view.setUint16(directory + 10, 8, true);
    if (kind === 'offset') view.setUint32(directory + 42, 0xffffffff, true);
    if (kind === 'link') view.setUint32(directory + 38, 0xa0000000, true);
    if (kind === 'unclaimed') view.setUint32(end + 16, directory - 1, true);
    if (kind === 'name') archive.set(text.encode('../evil.json!'), directory + 46);
    expect(() => readArchiveZip(archive)).toThrow();
  },
);
it('rejects disagreement between a local file header and the directory', async () => {
  const archive = await createBrewArchive(database(), metadata, hash);
  new DataView(archive.buffer).setUint32(18, 1, true);
  expect(() => readArchiveZip(archive)).toThrow();
});
it('checks a checksum-valid SQLite header before exposing a database', async () => {
  const original = await createBrewArchive(database(), metadata, hash);
  const files = readArchiveZip(original);
  const image = files['library.sqlite'].slice();
  image[16] = 3;
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
  manifest.database.sha256 = await hash.sha256(image);
  await expect(
    readBrewArchive(writeArchiveZip(text.encode(JSON.stringify(manifest)), image), hash),
  ).rejects.toThrow(/page size/);
});
it.each([
  { version: 2 },
  { createdAt: '2026-02-30T12:00:00.000Z' },
  { source: 'hosted' },
  { migrations: [] },
  { migrations: ['0001_initial.sql', '0001_initial.sql'] },
  { migrations: ['../initial.sql'] },
  { preferences: { constructor: 'unsafe' } },
  { database: { file: '../library.sqlite', bytes: 512, sha256: '0'.repeat(64) } },
])('rejects invalid manifests: %j', async (patch) => {
  const archive = await readBrewArchive(await createBrewArchive(database(), metadata, hash), hash);
  expect(() => archiveManifest({ ...archive.manifest, ...patch })).toThrow();
});
it('never produces an archive whose manifest exceeds the reader limit', async () => {
  const migrations = Array.from(
    { length: 4096 },
    (_, index) => String(index).padStart(4, '0') + '_archive_migration.sql',
  );
  const failure = await createBrewArchive(database(), { ...metadata, migrations }, hash).then(
    () => 'unexpected success',
    (error) => error.message,
  );
  expect(failure).toMatch(/manifest is too large/);
});
