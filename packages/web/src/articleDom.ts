/** Shared stable DOM state for article rows, reading panes and newsletter letters. */
export function articleDom(
  value: {
    id: number;
    readAt?: string | null;
    starredAt?: string | null;
    highlightColor?: string | null;
  },
  kind: 'article' | 'letter' = 'article',
) {
  return {
    'data-brew-id': value.id,
    'data-brew-kind': kind,
    'data-brew-state': [
      value.readAt ? 'read' : 'unread',
      value.starredAt ? 'starred' : '',
      value.highlightColor ? 'highlighted' : '',
    ]
      .filter(Boolean)
      .join(' '),
  };
}
