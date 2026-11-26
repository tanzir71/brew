import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Checkbox } from '../components/controls';

const filterKey = ['rule-duplicate-filter'];
async function filterRequest(init?: RequestInit): Promise<{ enabled: boolean }> {
  const response = await fetch('/api/rules/duplicate-filter', {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  });
  const value = await response.json();
  if (!response.ok || typeof value.enabled !== 'boolean')
    throw new Error(value.error ?? 'Could not read the saved duplicate filter.');
  return value;
}
export function RulesSettings() {
  const client = useQueryClient();
  const filter = useQuery({
    queryKey: filterKey,
    queryFn: ({ signal }) => filterRequest({ signal }),
    retry: false,
  });
  const [pending, setPending] = useState(false);
  const [failedChoice, setFailedChoice] = useState<boolean | null>(null);
  const [filterMessage, setFilterMessage] = useState('');
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );
  const [requesting, setRequesting] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');
  const writing = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const readPermission = () =>
      setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
    window.addEventListener('focus', readPermission);
    return () => {
      alive.current = false;
      window.removeEventListener('focus', readPermission);
    };
  }, []);
  const saveFilter = async (enabled: boolean) => {
    if (writing.current) return;
    writing.current = true;
    setPending(true);
    setFilterMessage('Saving duplicate filter…');
    try {
      await client.cancelQueries({ queryKey: filterKey });
      const saved = await filterRequest({ method: 'PUT', body: JSON.stringify({ enabled }) });
      client.setQueryData(filterKey, saved);
      if (alive.current) {
        setFailedChoice(null);
        setFilterMessage(
          saved.enabled ? 'Duplicate filter enabled.' : 'Duplicate filter disabled.',
        );
      }
    } catch (error) {
      if (alive.current) {
        setFailedChoice(enabled);
        setFilterMessage(
          `Save result was not confirmed. ${(error as Error).message} Retry the same setting to check it.`,
        );
      }
    } finally {
      writing.current = false;
      if (alive.current) setPending(false);
    }
  };
  const requestNotifications = async () => {
    if (requesting || typeof Notification === 'undefined') return;
    setRequesting(true);
    setNotificationMessage('Waiting for notification permission…');
    try {
      const result = await Notification.requestPermission();
      if (!alive.current) return;
      setPermission(result);
      setNotificationMessage(
        result === 'granted'
          ? 'Notifications enabled.'
          : result === 'denied'
            ? 'Notifications are blocked. Change permission in your browser settings to enable them.'
            : 'Permission was not granted. You can try Enable notifications again.',
      );
    } catch {
      if (alive.current)
        setNotificationMessage(
          'Could not request notification permission. Try Enable notifications again.',
        );
    } finally {
      if (alive.current) setRequesting(false);
    }
  };
  return (
    <>
      <button
        type="button"
        data-brew-action="enable-notifications"
        disabled={
          requesting ||
          permission === 'unsupported' ||
          permission === 'granted' ||
          permission === 'denied'
        }
        onClick={() => void requestNotifications()}
        className="mt-3 rounded-lg border border-line-strong px-3 py-2 text-xs font-medium text-soft disabled:opacity-60"
      >
        {requesting
          ? 'Requesting permission…'
          : permission === 'unsupported'
            ? 'Notifications unavailable'
            : permission === 'granted'
              ? 'Notifications enabled'
              : permission === 'denied'
                ? 'Notifications blocked'
                : 'Enable notifications'}
      </button>
      <p role="status" aria-label="Notification permission" className="mt-2 text-xs text-soft">
        {notificationMessage ||
          (permission === 'unsupported'
            ? 'This browser does not support notifications.'
            : permission === 'denied'
              ? 'Enable notifications in your browser settings.'
              : '')}
      </p>
      <Checkbox
        className="mt-3"
        label="Hide near-duplicate titles (3 days)"
        data-brew-action="set-duplicate-filter"
        checked={filter.data?.enabled ?? false}
        disabled={!filter.data || pending || failedChoice !== null}
        onChange={(event) => void saveFilter(event.target.checked)}
      />
      <div role="status" aria-label="Duplicate filter result" className="mt-2 text-xs text-soft">
        {filterMessage ||
          (filter.isError
            ? 'Could not read the duplicate filter. The displayed value is not confirmed.'
            : filter.isPending
              ? 'Loading duplicate filter…'
              : '')}
      </div>
      {filter.isError && (
        <button
          type="button"
          className="brew-compact-control mt-2 text-xs text-accent"
          onClick={() => void filter.refetch()}
        >
          Retry duplicate filter read
        </button>
      )}
      {failedChoice !== null && (
        <button
          type="button"
          disabled={pending}
          className="brew-compact-control mt-2 text-xs text-accent"
          onClick={() => void saveFilter(failedChoice)}
        >
          Retry duplicate filter save
        </button>
      )}
    </>
  );
}
