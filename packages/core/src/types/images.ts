export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Optional private instance cache. Keys are complete source URLs, including queries. */
export interface ImageCachePort {
  get(source: string): Promise<Response | null>;
  put(source: string, bytes: ArrayBuffer, contentType: string): Promise<void>;
}
