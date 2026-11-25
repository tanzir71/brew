import type { ParsedArticle } from './feed-parser.js';
export function adaptiveInterval(current: number, articles: ParsedArticle[], now = new Date()): number {
  const dayAgo = now.getTime() - 86_400_000;
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const daily = articles.filter((article) => article.publishedAt.getTime() >= dayAgo).length;
  const weekly = articles.filter((article) => article.publishedAt.getTime() >= weekAgo).length;
  if (daily > 10) return Math.max(15, Math.round(current * 0.75));
  if (weekly < 1) return Math.min(360, Math.max(15, Math.round(current * 1.5)));
  return Math.max(15, Math.min(1_440, current));
}

export function effectiveInterval(feed: { fetchIntervalMinutes: number; consecutiveFailures: number }): number {
  return Math.min(1_440, feed.fetchIntervalMinutes * 2 ** feed.consecutiveFailures);
}
