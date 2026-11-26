import type { ArticleSummary } from './types/api.js';
import type { ReaderPageState } from './reader-pages.js';
import { readerPageHref, readerPageSize } from './reader-pages.js';
import { cleanOutputText, escapeMarkdown, outputUrl } from './brew-output-content.js';

export function readerPageDocument(
  state: ReaderPageState,
  title: string,
  items: ArticleSummary[],
  total: number,
  base: string,
) {
  const start = (state.page - 1) * readerPageSize;
  const href = readerPageHref(state);
  return {
    version: 1,
    kind: state.kind,
    title: cleanOutputText(title),
    url: outputUrl(href, base),
    filters: { ...state },
    page: state.page,
    pageSize: readerPageSize,
    total,
    showing: { from: items.length ? start + 1 : 0, to: items.length ? start + items.length : 0 },
    previous:
      state.page > 1 ? outputUrl(readerPageHref({ ...state, page: state.page - 1 }), base) : null,
    next:
      start + readerPageSize < total
        ? outputUrl(readerPageHref({ ...state, page: state.page + 1 }), base)
        : null,
    items: items.map((item) => ({
      id: item.id,
      title: cleanOutputText(item.title),
      author: item.author ? cleanOutputText(item.author) : null,
      feedId: item.feedId,
      feedTitle: cleanOutputText(item.feedTitle),
      folderId: item.folderId,
      publishedAt: item.publishedAt,
      readAt: item.readAt,
      starredAt: item.starredAt,
      highlightColor: item.highlightColor,
      url: outputUrl(`/a/${item.id}`, base),
      original: outputUrl(item.url, base),
      markdown: outputUrl(`/a/${item.id}.md`, base),
      json: outputUrl(`/a/${item.id}.json`, base),
    })),
  };
}
export function renderReaderPageMarkdown(value: ReturnType<typeof readerPageDocument>): string {
  return (
    [
      `# ${escapeMarkdown(value.title)}`,
      `Showing ${value.showing.from}–${value.showing.to} of ${value.total}`,
      `Page ${value.page} · ${value.filters.unread ? 'Unread' : 'All'} · ${value.filters.sort}`,
      ...value.items.map((item) =>
        [
          `## ${escapeMarkdown(item.title)}`,
          `${escapeMarkdown(item.feedTitle)} · ${item.publishedAt}`,
          `${item.readAt ? 'Read' : 'Unread'}${item.starredAt ? ' · Starred' : ''}${item.highlightColor ? ' · Highlighted' : ''}`,
          `[Read](<${item.url}>) · [Markdown](<${item.markdown}>) · [JSON](<${item.json}>)`,
        ].join('\n\n'),
      ),
      value.previous ? `[Previous](<${value.previous}>)` : '',
      value.next ? `[Next](<${value.next}>)` : '',
    ]
      .filter(Boolean)
      .join('\n\n') + '\n'
  );
}
