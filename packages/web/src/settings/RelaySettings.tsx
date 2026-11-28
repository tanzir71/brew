import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input } from '../components/controls';
import { Badge } from '../components/Badge';
import { useQueryClient } from '@tanstack/react-query';

interface Status {
  endpoint: string | null;
  configured: boolean;
}
export function RelaySettings() {
  const client = useQueryClient();
  const [status, setStatus] = useState<Status>();
  const [endpoint, setEndpoint] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const pending = useRef<AbortController>();
  const load = useCallback(async () => {
    pending.current?.abort();
    const controller = (pending.current = new AbortController());
    try {
      const response = await fetch('/api/browser/relay', {
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Could not read the relay settings. Try again.');
      const value = (await response.json()) as Status;
      if (!controller.signal.aborted) {
        setStatus(value);
        setEndpoint(value.endpoint ?? '');
        setError('');
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : 'Could not read the relay settings.');
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      pending.current?.abort();
    };
  }, [load]);
  const save = async (remove = false) => {
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const response = await fetch('/api/browser/relay', {
        method: remove ? 'DELETE' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: remove ? undefined : JSON.stringify({ endpoint, token }),
        cache: 'no-store',
      });
      const value = await response.json();
      if (!response.ok)
        throw new Error(value.error ?? value.message ?? 'Could not save the relay settings.');
      setStatus(value);
      setEndpoint(value.endpoint ?? '');
      setToken('');
      void client.invalidateQueries({ queryKey: ['capabilities'] });
      setSaved(
        remove
          ? 'Relay disconnected. Your feeds and articles are kept.'
          : 'Relay settings saved. New feeds use this connection.',
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save the relay settings.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="relay-settings" aria-label="Feed relay settings">
      <h3>Connect your relay</h3>
      <p>
        Use a relay you control. It receives the feed URLs you request. The token stays in this
        browser’s library.
      </p>
      <a
        href="https://github.com/tanzir71/brew/tree/main/targets/browser/relay"
        target="_blank"
        rel="noreferrer"
      >
        Relay Worker and setup instructions
      </a>
      {!status ? (
        error ? (
          <Button variant="secondary" onClick={() => void load()}>
            Retry relay settings
          </Button>
        ) : (
          <p role="status">Reading relay settings…</p>
        )
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Badge tone={status.configured ? 'positive' : 'warning'}>
            {status.configured ? 'Configured' : 'Needs setup'}
          </Badge>
          <div>
            <Input
              label="Relay URL"
              type="url"
              required
              placeholder="https://your-relay.workers.dev/"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              disabled={busy}
            />
          </div>
          <div>
            <Input
              label="Relay token"
              type="password"
              required={!status.configured}
              autoComplete="new-password"
              spellCheck={false}
              placeholder={
                status.configured
                  ? 'Saved — enter a new token to replace it'
                  : 'At least 32 characters'
              }
              value={token}
              onChange={(event) => setToken(event.target.value)}
              disabled={busy}
            />
          </div>
          <div className="relay-settings-actions">
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save relay'}
            </Button>
            {status.configured && (
              <Button variant="secondary" disabled={busy} onClick={() => void save(true)}>
                Disconnect relay
              </Button>
            )}
          </div>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      <p role="status">{saved}</p>
    </section>
  );
}
