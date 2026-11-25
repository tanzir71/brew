export function letterDate(
  value: string,
  full = false,
  issue?: { at: string; timeZone: string },
): string {
  const date = new Date(value);
  const today = issue ? new Date(issue.at) : new Date();
  const calendarDay = (date: Date) => {
    if (!issue) return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: issue.timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(date);
    const part = (type: string) => Number(parts.find((item) => item.type === type)!.value);
    return Date.UTC(part('year'), part('month') - 1, part('day'));
  };
  const ago = Math.round((calendarDay(today) - calendarDay(date)) / 86_400_000);
  const time = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(issue ? { timeZone: issue.timeZone } : {}),
  });
  if (ago === 0) return full ? `Today ${time}` : time;
  if (ago === 1) return full ? `Yesterday ${time}` : 'Yesterday';
  return date.toLocaleDateString(undefined, {
    ...(ago > 1 && ago < 7
      ? { weekday: 'short' as const }
      : { month: 'short' as const, day: 'numeric' as const }),
    ...(issue ? { timeZone: issue.timeZone } : {}),
  });
}
export const senderInitial = (title: string): string => title.replace(/^the\s+/i, '')[0] ?? 'N';
