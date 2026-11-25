import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export function json(c: Context, value: unknown, status: ContentfulStatusCode = 200): Response {
  return c.body(JSON.stringify(value), status, {
    'Content-Type': 'application/json; charset=utf-8',
  });
}
export const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;
export const isJsonContentType = (value: string | null | undefined): boolean =>
  value?.split(';')[0]?.trim().toLowerCase() === 'application/json';
export const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
};
export async function body<T = Record<string, unknown>>(c: Context): Promise<T> {
  if (!isJsonContentType(c.req.header('content-type'))) return undefined as T;
  return c.req.json<T>();
}
