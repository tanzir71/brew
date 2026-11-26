import { useEffect } from 'react';

// A reading pane takes precedence over its underlying page. Removing it restores
// the currently mounted page, including changes received while the pane was open.
const entries = new Map<symbol, { path: string; priority: number }>();
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
        link.href = `${current.path}.${format}`;
        document.head.append(link);
        return link;
      })
    : [];
}
export function useTextAlternates(path: string | null, priority = 10) {
  useEffect(() => {
    if (!path) return;
    const key = Symbol();
    entries.set(key, { path, priority });
    refresh();
    return () => {
      entries.delete(key);
      refresh();
    };
  }, [path, priority]);
}
