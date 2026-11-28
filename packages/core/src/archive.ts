import type { Capabilities } from './types/capabilities.js';
import { readArchiveZip, writeArchiveZip } from './archive-zip.js';

export interface ArchiveHashPort {
  sha256(bytes: Uint8Array): Promise<string>;
}
export interface ArchiveMetadata {
  createdAt: string;
  source: Capabilities['mode'];
  migrations: string[];
  preferences?: Record<string, string>;
}
export interface ArchiveManifest extends ArchiveMetadata {
  format: 'brew';
  version: 1;
  database: { file: 'library.sqlite'; bytes: number; sha256: string };
}
export interface BrewArchive {
  manifest: ArchiveManifest;
  database: Uint8Array<ArrayBuffer>;
}
const text = new TextEncoder();
function check(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export function archiveManifest(value: unknown): ArchiveManifest {
  check(
    object(value) && value.format === 'brew' && value.version === 1,
    'This Brew archive version is not supported.',
  );
  const database = value.database;
  check(
    object(database) &&
      database.file === 'library.sqlite' &&
      typeof database.bytes === 'number' &&
      Number.isSafeInteger(database.bytes) &&
      database.bytes >= 512 &&
      typeof database.sha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(database.sha256),
    'The Brew archive database manifest is invalid.',
  );
  check(
    typeof value.createdAt === 'string' &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.createdAt) &&
      Number.isFinite(Date.parse(value.createdAt)) &&
      new Date(value.createdAt).toISOString() === value.createdAt,
    'The Brew archive date is invalid.',
  );
  check(
    typeof value.source === 'string' &&
      ['node', 'browser', 'cloudflare', 'static', 'php-lite'].includes(value.source),
    'The Brew archive source is invalid.',
  );
  check(
    Array.isArray(value.migrations) &&
      value.migrations.length > 0 &&
      value.migrations.length <= 4096 &&
      value.migrations.every(
        (name) => typeof name === 'string' && /^\d{4}_[a-z0-9_-]+\.sql$/i.test(name),
      ) &&
      new Set(value.migrations).size === value.migrations.length,
    'The Brew archive migration list is invalid.',
  );
  if (value.preferences !== undefined)
    check(
      object(value.preferences) &&
        Object.keys(value.preferences).length <= 64 &&
        Object.entries(value.preferences).every(
          ([key, value]) =>
            /^[a-z][a-zA-Z0-9]{0,63}$/.test(key) &&
            !['constructor', 'prototype'].includes(key) &&
            typeof value === 'string' &&
            value.length <= 256,
        ),
      'The Brew archive preferences are invalid.',
    );
  return {
    format: 'brew',
    version: 1,
    createdAt: value.createdAt,
    source: value.source as Capabilities['mode'],
    migrations: [...value.migrations] as string[],
    database: { file: 'library.sqlite', bytes: database.bytes, sha256: database.sha256 },
    ...(value.preferences === undefined
      ? {}
      : {
          preferences: Object.fromEntries(
            Object.entries(value.preferences as Record<string, string>),
          ),
        }),
  };
}
/** Only a cheap header check; target adapters must also validate schema, integrity and references. */
export function sqliteArchiveHeader(image: Uint8Array) {
  check(
    image.length >= 512 && new TextDecoder().decode(image.subarray(0, 16)) === 'SQLite format 3\0',
    'The archive does not contain a SQLite database.',
  );
  const header = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const encoded = header.getUint16(16);
  const pageSize = encoded === 1 ? 65536 : encoded;
  check(
    pageSize >= 512 &&
      pageSize <= 65536 &&
      (pageSize & (pageSize - 1)) === 0 &&
      image.length % pageSize === 0,
    'The SQLite archive page size or file length is invalid.',
  );
  check(
    [1, 2].includes(image[18]!) &&
      [1, 2].includes(image[19]!) &&
      image[21] === 64 &&
      image[22] === 32 &&
      image[23] === 32 &&
      header.getUint32(28) === image.length / pageSize,
    'The SQLite archive header is incomplete or invalid.',
  );
}
export async function createBrewArchive(
  database: Uint8Array,
  metadata: ArchiveMetadata,
  hash: ArchiveHashPort,
) {
  sqliteArchiveHeader(database);
  const manifest = archiveManifest({
    ...metadata,
    format: 'brew',
    version: 1,
    database: {
      file: 'library.sqlite',
      bytes: database.length,
      sha256: await hash.sha256(database),
    },
  });
  const encoded = text.encode(JSON.stringify(manifest));
  check(encoded.length <= 65536, 'The Brew archive manifest is too large.');
  return writeArchiveZip(encoded, database);
}
export async function readBrewArchive(
  bytes: Uint8Array,
  hash: ArchiveHashPort,
): Promise<BrewArchive> {
  const files = readArchiveZip(bytes);
  check(files['manifest.json'].length <= 65536, 'The Brew archive manifest is too large.');
  const manifest = archiveManifest(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files['manifest.json'])),
  );
  const database = files['library.sqlite'];
  check(
    database.length === manifest.database.bytes &&
      (await hash.sha256(database)) === manifest.database.sha256,
    'The Brew archive failed its database checksum. Your current library has not been changed.',
  );
  sqliteArchiveHeader(database);
  return { manifest, database: database.slice() };
}
