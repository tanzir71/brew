const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const names = ['manifest.json', 'library.sqlite'] as const;
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
export function archiveCrc32(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255]!;
  return (value ^ 0xffffffff) >>> 0;
}
function checked(
  value: boolean,
  message = 'This is not a supported Brew ZIP file.',
): asserts value {
  if (!value) throw new Error(message);
}
function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
function range(offset: number, length: number, limit: number) {
  checked(
    Number.isSafeInteger(offset) &&
      Number.isSafeInteger(length) &&
      offset >= 0 &&
      length >= 0 &&
      offset + length <= limit,
    'The Brew ZIP file is truncated or has invalid offsets.',
  );
}
/** A standard, stored ZIP32 with exactly two files. No compression dependency or ZIP bomb surface. */
export function writeArchiveZip(
  manifest: Uint8Array,
  database: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const entries = [manifest, database].map((bytes, index) => ({
    bytes,
    name: encoder.encode(names[index]!),
    crc: archiveCrc32(bytes),
  }));
  const size = entries.reduce(
    (size, entry) => size + 30 + 46 + entry.name.length * 2 + entry.bytes.length,
    22,
  );
  checked(size <= 0xffffffff, 'This library exceeds the ZIP32 archive size limit.');
  const output = new Uint8Array(size);
  const data = view(output);
  const offsets: number[] = [];
  let offset = 0;
  for (const entry of entries) {
    offsets.push(offset);
    data.setUint32(offset, 0x04034b50, true);
    data.setUint16(offset + 4, 20, true);
    data.setUint16(offset + 6, 0x800, true);
    data.setUint16(offset + 12, 0x21, true);
    data.setUint32(offset + 14, entry.crc, true);
    data.setUint32(offset + 18, entry.bytes.length, true);
    data.setUint32(offset + 22, entry.bytes.length, true);
    data.setUint16(offset + 26, entry.name.length, true);
    output.set(entry.name, offset + 30);
    output.set(entry.bytes, offset + 30 + entry.name.length);
    offset += 30 + entry.name.length + entry.bytes.length;
  }
  const directory = offset;
  for (const [index, entry] of entries.entries()) {
    data.setUint32(offset, 0x02014b50, true);
    data.setUint16(offset + 4, 20, true);
    data.setUint16(offset + 6, 20, true);
    data.setUint16(offset + 8, 0x800, true);
    data.setUint16(offset + 14, 0x21, true);
    data.setUint32(offset + 16, entry.crc, true);
    data.setUint32(offset + 20, entry.bytes.length, true);
    data.setUint32(offset + 24, entry.bytes.length, true);
    data.setUint16(offset + 28, entry.name.length, true);
    data.setUint32(offset + 42, offsets[index]!, true);
    output.set(entry.name, offset + 46);
    offset += 46 + entry.name.length;
  }
  data.setUint32(offset, 0x06054b50, true);
  data.setUint16(offset + 8, 2, true);
  data.setUint16(offset + 10, 2, true);
  data.setUint32(offset + 12, offset - directory, true);
  data.setUint32(offset + 16, directory, true);
  return output;
}
/** Validate both directory and local headers before admitting any database bytes. */
export function readArchiveZip(bytes: Uint8Array): Record<(typeof names)[number], Uint8Array> {
  checked(bytes.length >= 22);
  const data = view(bytes);
  const end = bytes.length - 22;
  checked(data.getUint32(end, true) === 0x06054b50 && data.getUint16(end + 20, true) === 0);
  checked(
    data.getUint16(end + 4, true) === 0 &&
      data.getUint16(end + 6, true) === 0 &&
      data.getUint16(end + 8, true) === 2 &&
      data.getUint16(end + 10, true) === 2,
  );
  const start = data.getUint32(end + 16, true);
  const directorySize = data.getUint32(end + 12, true);
  range(start, directorySize, end);
  checked(start + directorySize === end);
  const found = new Map<string, Uint8Array>();
  const spans: Array<[number, number]> = [];
  let offset = start;
  for (let index = 0; index < 2; index++) {
    range(offset, 46, end);
    checked(data.getUint32(offset, true) === 0x02014b50);
    const flags = data.getUint16(offset + 8, true);
    const method = data.getUint16(offset + 10, true);
    checked(
      (flags === 0 || flags === 0x800) && method === 0,
      'Use the original .brew file. Encrypted or recompressed ZIP files are not supported.',
    );
    const crc = data.getUint32(offset + 16, true);
    const length = data.getUint32(offset + 24, true);
    checked(data.getUint32(offset + 20, true) === length);
    const nameLength = data.getUint16(offset + 28, true);
    const extra = data.getUint16(offset + 30, true);
    const comment = data.getUint16(offset + 32, true);
    checked(data.getUint16(offset + 34, true) === 0);
    const unixType = (data.getUint32(offset + 38, true) >>> 16) & 0xf000;
    checked(
      unixType === 0 || unixType === 0x8000,
      'Brew archives cannot contain links or directories.',
    );
    range(offset + 46, nameLength + extra + comment, end);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    checked(
      names.some((value) => value === name) && !found.has(name),
      'A Brew archive must contain exactly manifest.json and library.sqlite.',
    );
    const local = data.getUint32(offset + 42, true);
    range(local, 30, start);
    checked(
      data.getUint32(local, true) === 0x04034b50 &&
        data.getUint16(local + 6, true) === flags &&
        data.getUint16(local + 8, true) === method,
    );
    checked(
      data.getUint32(local + 14, true) === crc &&
        data.getUint32(local + 18, true) === length &&
        data.getUint32(local + 22, true) === length,
    );
    const localNameLength = data.getUint16(local + 26, true);
    const localExtra = data.getUint16(local + 28, true);
    range(local + 30, localNameLength + localExtra, start);
    checked(decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) === name);
    const payload = local + 30 + localNameLength + localExtra;
    range(payload, length, start);
    const content = bytes.subarray(payload, payload + length);
    checked(
      archiveCrc32(content) === crc,
      'The Brew archive failed its ZIP checksum. Keep the original library and choose an intact export.',
    );
    found.set(name, content);
    spans.push([local, payload + length]);
    offset += 46 + nameLength + extra + comment;
  }
  checked(offset === end && found.size === 2);
  spans.sort((a, b) => a[0] - b[0]);
  checked(
    spans[0]![0] === 0 && spans[0]![1] === spans[1]![0] && spans[1]![1] === start,
    'The Brew ZIP file has overlapping or unclaimed data.',
  );
  return {
    'manifest.json': found.get('manifest.json')!,
    'library.sqlite': found.get('library.sqlite')!,
  };
}
