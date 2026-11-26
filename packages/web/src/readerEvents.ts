let source: EventSource | undefined;
let subscribers = 0;

/** One connection per tab, shared by Reader and optional external-app synchronization. */
export function subscribeReaderEvents(handlers: Record<string, EventListener>) {
  const current = (source ??= new EventSource('/api/events'));
  subscribers++;
  for (const [name, handler] of Object.entries(handlers)) current.addEventListener(name, handler);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    for (const [name, handler] of Object.entries(handlers))
      current.removeEventListener(name, handler);
    if (--subscribers === 0) {
      current.close();
      if (source === current) source = undefined;
    }
  };
}
