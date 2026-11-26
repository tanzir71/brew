import {
  cleanOutputText,
  escapeMarkdown,
  outputBaseUrl,
  outputUrl,
} from './brew-output-content.js';

type Value = null | boolean | number | string | Value[] | { [key: string]: Value };
export interface PageItem {
  title: string;
  id?: number | string;
  url?: string;
  details?: unknown;
}
export interface PageSection {
  title: string;
  text?: string;
  data?: unknown;
  items?: PageItem[];
}
function clean(value: unknown): Value {
  if (typeof value === 'string') return cleanOutputText(value);
  if (typeof value === 'boolean' || value === null) return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .map(([key, child]) => [cleanOutputText(key), clean(child)]),
    );
  return null;
}
/** Callers explicitly project public fields before entering this shared serializer. */
export function pageDocument(
  kind: string,
  title: string,
  path: string,
  state: unknown,
  sections: PageSection[],
  base: string,
  representation = 'saved state',
) {
  const origin = outputBaseUrl(base)!;
  return {
    version: 1,
    kind,
    title: cleanOutputText(title),
    representation,
    url: outputUrl(path, origin),
    state: clean(state),
    sections: sections.map((section) => ({
      title: cleanOutputText(section.title),
      ...(section.text === undefined ? {} : { text: cleanOutputText(section.text) }),
      ...(section.data === undefined ? {} : { data: clean(section.data) }),
      ...(section.items === undefined
        ? {}
        : {
            items: section.items.map((item) => ({
              ...(item.id === undefined ? {} : { id: item.id }),
              title: cleanOutputText(item.title),
              ...(item.url === undefined ? {} : { url: outputUrl(item.url, origin) }),
              ...(item.details === undefined ? {} : { details: clean(item.details) }),
            })),
          }),
    })),
  };
}
export function renderPageMarkdown(value: ReturnType<typeof pageDocument>) {
  const data = (item: Value | undefined) =>
    item === undefined ? '' : `\`\`\`json\n${JSON.stringify(item, null, 2)}\n\`\`\``;
  return (
    [
      `# ${escapeMarkdown(value.title)}`,
      escapeMarkdown(value.representation),
      ...value.sections.flatMap((section) => [
        `## ${escapeMarkdown(section.title)}`,
        section.text ? escapeMarkdown(section.text) : '',
        data(section.data),
        ...(section.items ?? []).flatMap((item) => [
          `### ${item.url ? `[${escapeMarkdown(item.title)}](<${item.url}>)` : escapeMarkdown(item.title)}`,
          data(item.details),
        ]),
      ]),
    ]
      .filter(Boolean)
      .join('\n\n') + '\n'
  );
}
