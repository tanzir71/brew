import type { R2Bucket } from '@cloudflare/workers-types';
import { MAX_IMAGE_BYTES, type ImageCachePort } from '../../../packages/core/src/types/images.js';

const day = 86_400_000;
async function imageKey(source: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return (
    'images/' +
    [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
  );
}
/** Bucket remains private; neither origin URLs nor their signed query strings become object names. */
export class R2ImageCache implements ImageCachePort {
  constructor(
    private bucket: R2Bucket,
    private now = Date.now,
  ) {}
  async get(source: string) {
    const object = await this.bucket.get(await imageKey(source));
    if (!object) return null;
    const expires = Number(object.customMetadata?.expiresAt);
    if (!Number.isFinite(expires) || expires <= this.now() || object.size > MAX_IMAGE_BYTES) {
      await object.body.cancel();
      return null;
    }
    const contentType = object.httpMetadata?.contentType ?? '';
    if (!contentType.startsWith('image/')) {
      await object.body.cancel();
      return null;
    }
    return new Response(await object.arrayBuffer(), {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=86400' },
    });
  }
  async put(source: string, bytes: ArrayBuffer, contentType: string) {
    await this.bucket.put(await imageKey(source), bytes, {
      httpMetadata: { contentType },
      customMetadata: { expiresAt: String(this.now() + day) },
    });
  }
}
