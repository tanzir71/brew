import { useEffect } from 'react';
import { textTwinHref } from '@brew/core/reader-pages';

// A reading pane takes precedence over its underlying page. Removing it restores
// the currently mounted page, including changes received while the pane was open.
const entries = new Map<symbol, { path: string; priority: number; title?: string }>();
let owned: HTMLLinkElement[] = [];
function refresh() {
  owned.forEach((link) => link.remove());
  const current = [...entries.values()].sort((a, b) => b.priority - a.priority)[0];
  owned = current
    ? [
        ['md', 'text/markdown'],
        ['json', 'application/json'],
      ].map(([format, type]) => {
        const link = document.createElement('link');
        link.rel = 'alternate';
        link.type = type!;
        link.href = textTwinHref(current.path, format as 'md' | 'json');
        if (current.title) link.title = current.title;
        document.head.append(link);
        return link;
      })
    : [];
}
export function useTextAlternates(path: string | null, priority = 10, title?: string) {
  useEffect(() => {
    if (!path) return;
    const key = Symbol();
    entries.set(key, { path, priority, title });
    refresh();
    return () => {
      entries.delete(key);
      refresh();
    };
  }, [path, priority, title]);
}
