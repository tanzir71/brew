export const opmlDocumentLimit = 1_000_000;
export interface OpmlImportResult {
  imported: number;
  skipped: number;
  foldersCreated: number;
}
export interface OpmlPreview extends OpmlImportResult {
  outlines: Array<{
    title: string;
    source: string;
    folder: string | null;
    status: 'add' | 'subscribed' | 'duplicate';
  }>;
}
export function opmlDocument(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('OPML document is required.');
  if (new TextEncoder().encode(value).byteLength > opmlDocumentLimit)
    throw new Error('Choose an OPML file smaller than 1 MB.');
  return value;
}
