import { MAX_IMAGE_BYTES, type ImageCachePort } from '../../core/src/types/images.js';
export { MAX_IMAGE_BYTES };

export async function proxyImage(source: URL, fetcher: typeof fetch, cache?: ImageCachePort) {
  if (!['http:', 'https:'].includes(source.protocol)) throw new Error('Unsupported image URL');
  source.hash = '';
  const key = source.href;
  // A cache outage must not prevent an otherwise healthy origin from serving an image.
  const cached = await cache?.get(key).catch(() => null);
  if (cached) return cached;
  const response = await fetcher(source, {
    signal: AbortSignal.timeout(8_000),
    redirect: 'follow',
  });
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  if (!response.ok || !contentType.startsWith('image/')) {
    await response.body?.cancel();
    throw new Error('Image could not be loaded');
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > MAX_IMAGE_BYTES) {
          await reader.cancel();
          throw new Error('Image is too large');
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const privateOrigin =
    /(?:^|,)\s*(?:private|no-store|no-cache)\b/i.test(
      response.headers.get('cache-control') ?? '',
    ) || response.headers.has('set-cookie');
  if (cache && !privateOrigin) await cache.put(key, bytes.buffer, contentType).catch(() => {});
  return new Response(bytes, {
    headers: { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=86400' },
  });
}
