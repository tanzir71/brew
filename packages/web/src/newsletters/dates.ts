export function letterDate(value: string, full = false): string {
  const date = new Date(value);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const ago = Math.round((start.getTime() - day.getTime()) / 86_400_000);
  const time = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  if (ago === 0) return full ? `Today ${time}` : time;
  if (ago === 1) return full ? `Yesterday ${time}` : 'Yesterday';
  return date.toLocaleDateString(
    undefined,
    ago > 1 && ago < 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' },
  );
}
export const senderInitial = (title: string): string => title.replace(/^the\s+/i, '')[0] ?? 'N';
