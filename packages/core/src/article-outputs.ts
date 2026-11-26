import type { ArticleDetail } from './types/api.js';
import {
  cleanOutputText,
  escapeMarkdown,
  outputBaseUrl,
  outputBodyText,
  outputHtml,
  outputImage,
  outputUrl,
} from './brew-output-content.js';

/** Narrow forwarding predicate: HTML article routes remain owned by the SPA. */
export const isArticleOutputPath = (path: string): boolean => /^\/a\/[^/]+\.(md|json)$/.test(path);

/** A readable content twin; never include raw mail, tracking details or mutable state. */
export function articleDocument(article: ArticleDetail, base?: string) {
  const baseUrl = outputBaseUrl(base);
  return {
    version: 1,
    id: article.id,
    title: cleanOutputText(article.title),
    url: outputUrl(article.url, baseUrl),
    author: article.author ? cleanOutputText(article.author) : null,
    publishedAt: article.publishedAt,
    feedTitle: cleanOutputText(article.feedTitle),
    readTimeMinutes: article.readTimeMinutes,
    imageUrl: article.imageUrl ? outputImage(article.imageUrl, baseUrl) : null,
    contentHtml: outputHtml(article.fullTextHtml ?? article.contentHtml ?? article.summaryHtml, {
      images: true,
      baseUrl,
      local: true,
    }),
  };
}
export function renderArticleJson(article: ArticleDetail, baseUrl?: string): string {
  return JSON.stringify(articleDocument(article, baseUrl), null, 2) + '\n';
}
export function renderArticleMarkdown(article: ArticleDetail, baseUrl?: string): string {
  const value = articleDocument(article, baseUrl);
  return (
    [
      `# ${escapeMarkdown(value.title)}`,
      `${escapeMarkdown(value.feedTitle)}${value.author ? ` · ${escapeMarkdown(value.author)}` : ''}`,
      value.publishedAt,
      value.url ? `[Original](<${value.url}>)` : '',
      outputBodyText(value.contentHtml, true),
    ]
      .filter(Boolean)
      .join('\n\n') + '\n'
  );
}
