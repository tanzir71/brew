import { useEffect, useState } from 'react';

/** A rendered clock for expiring controls; no impure reads during render. */
export function useClock(interval = 1000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}
