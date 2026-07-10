import Parser from 'rss-parser';

const parser = new Parser();

export interface ParsedArticle {
  guid: string;
  url: string;
  title: string;
  author: string | null;
  summaryHtml: string | null;
  contentHtml: string | null;
  publishedAt: Date;
  enclosureUrl?: string | null;
  enclosureType?: string | null;
}

export interface ParsedFeedDocument {
  title: string;
  siteUrl: string | null;
  description: string | null;
  articles: ParsedArticle[];
}

const dateOrNow = (value: unknown): Date => {
  if (typeof value === 'string' || typeof value === 'number') { const date = new Date(value); if (!Number.isNaN(date.getTime())) return date; }
  return new Date();
};

export async function parseFeedDocument(body: string, contentType = ''): Promise<ParsedFeedDocument> {
  const trimmed = body.trimStart();
  if (contentType.includes('json') || trimmed.startsWith('{')) {
    const value = JSON.parse(body) as { version?: unknown; title?: unknown; home_page_url?: unknown; description?: unknown; items?: unknown };
    if (typeof value.version !== 'string' || !value.version.includes('jsonfeed.org') || !Array.isArray(value.items)) throw new Error('Invalid JSON Feed');
    const articles = value.items.map((raw): ParsedArticle => {
      const item = raw as Record<string, unknown>;
      const url = typeof item.url === 'string' ? item.url : typeof item.external_url === 'string' ? item.external_url : '';
      const guid = typeof item.id === 'string' ? item.id : url;
      if (!guid) throw new Error('JSON Feed item has no id or URL');
      const attachment=Array.isArray(item.attachments)?item.attachments.find((value)=>typeof (value as {mime_type?:unknown}).mime_type==='string'&&String((value as {mime_type:string}).mime_type).startsWith('audio/')) as {url?:unknown;mime_type?:unknown}|undefined:undefined;
      return { guid, url, title: typeof item.title === 'string' ? item.title : '(untitled)', author: Array.isArray(item.authors) && typeof (item.authors[0] as { name?: unknown } | undefined)?.name === 'string' ? (item.authors[0] as { name: string }).name : null, summaryHtml: typeof item.summary === 'string' ? item.summary : null, contentHtml: typeof item.content_html === 'string' ? item.content_html : typeof item.content_text === 'string' ? item.content_text : null, publishedAt: dateOrNow(item.date_published), enclosureUrl:typeof attachment?.url==='string'?attachment.url:null,enclosureType:typeof attachment?.mime_type==='string'?attachment.mime_type:null };
    });
    return { title: typeof value.title === 'string' ? value.title : 'Untitled feed', siteUrl: typeof value.home_page_url === 'string' ? value.home_page_url : null, description: typeof value.description === 'string' ? value.description : null, articles };
  }

  const parsed = await parser.parseString(body);
  if (!parsed.items) throw new Error('Invalid RSS or Atom feed');
  return {
    title: parsed.title?.trim() || 'Untitled feed', siteUrl: parsed.link || null, description: parsed.description?.trim() || null,
    articles: parsed.items.map((item) => { const url = item.link ?? ''; const guid = item.guid ?? item.id ?? url; if (!guid) throw new Error('Feed item has no guid or URL'); return { guid, url, title: item.title?.trim() || '(untitled)', author: item.creator ?? item.author ?? null, summaryHtml: item.contentSnippet ?? item.summary ?? null, contentHtml: item['content:encoded'] ?? item.content ?? null, publishedAt: dateOrNow(item.isoDate ?? item.pubDate),enclosureUrl:item.enclosure?.url??null,enclosureType:item.enclosure?.type??null }; }),
  };
}
