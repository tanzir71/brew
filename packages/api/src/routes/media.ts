import type { Hono } from 'hono';
import type { ApiServices } from '../ports.js';
import { errorMessage, json } from '../http.js';

export function registerMediaRoutes(app: Hono, { fetcher }: ApiServices): void {
  app.get('/api/img', async (c) => {
    try {
      const src = c.req.query('src');
      if (!src) throw new Error('src is required');
      const source = new URL(src);
      if (!['http:', 'https:'].includes(source.protocol)) throw new Error('Unsupported image URL');
      const response = await fetcher(source, {
        signal: AbortSignal.timeout(8_000),
        redirect: 'follow',
      });
      const type = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
      if (!response.ok || !type.startsWith('image/')) throw new Error('Image could not be loaded');
      const data = await response.arrayBuffer();
      if (data.byteLength > 10 * 1024 * 1024) throw new Error('Image is too large');
      return c.body(data, 200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' });
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Invalid image URL') }, 400);
    }
  });
  app.get('/api/media', async (c) => {
    try {
      const src = c.req.query('src');
      if (!src) throw new Error('src is required');
      const source = new URL(src);
      if (!['http:', 'https:'].includes(source.protocol)) throw new Error('Unsupported media URL');
      const response = await fetcher(source, { signal: AbortSignal.timeout(10_000) });
      const type = response.headers.get('content-type')?.split(';')[0] ?? '';
      if (!response.ok || !type.startsWith('audio/')) throw new Error('Audio could not be loaded');
      return c.body(await response.arrayBuffer(), 200, {
        'Content-Type': type,
        'Cache-Control': 'private, max-age=86400',
      });
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Invalid media URL') }, 400);
    }
  });
}
