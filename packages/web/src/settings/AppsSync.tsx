import { useLayoutEffect, useEffect, useRef, useState, type RefObject } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { readerAppClients, readerServerUrls } from '@brew/core/reader-apps';
import { AppSidebar } from '../components/AppSidebar';
import { Badge } from '../components/Badge';
import { Button, Input } from '../components/controls';
import { CodeBlock } from '../components/patterns';
import { ModalSheet } from '../components/Sheet';
import { SettingsNav } from './SettingsNav';
import { agentPageHref } from '../agentLocation';
import { usePageAlternates } from '../hooks/usePageAlternates';
import { capabilitiesQueryKey } from '../hooks/useCapabilities';
import { changeReaderAccess, loadReaderAccess, readerAccessKey } from './readerAccessApi';

export function AppsSync() {
  usePageAlternates(agentPageHref('/settings/apps'), 'Apps & sync settings');
  const client = useQueryClient();
  const access = useQuery({
    queryKey: readerAccessKey,
    queryFn: ({ signal }) => loadReaderAccess(signal),
    staleTime: 0,
    retry: false,
  });
  const ready = !access.isError && access.data?.available === true;
  const settings = ready && access.data?.available ? access.data.settings : null;
  const urls = settings ?? readerServerUrls(location.origin);
  const [dialog, setDialog] = useState<{
    kind: 'password' | 'disable';
    enabled: boolean;
    username: string;
  } | null>(null);
  const [notice, setNotice] = useState('');
  const generate = useRef<HTMLButtonElement>(null);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const focusAfterDisable = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const forget = () => setDialog(null);
    window.addEventListener('pagehide', forget);
    return () => window.removeEventListener('pagehide', forget);
  }, []);
  useEffect(() => {
    if (focusAfterDisable.current && !dialog && !access.isFetching) {
      focusAfterDisable.current = false;
      if (
        document.activeElement === document.body ||
        document.activeElement === pageHeading.current
      )
        generate.current?.focus({ preventScroll: true });
    }
  }, [dialog, access.isFetching]);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: readerAccessKey });
    void client.invalidateQueries({ queryKey: capabilitiesQueryKey });
  };
  return (
    <div className="runs-app agent-app apps-app">
      <AppSidebar activeHref="/settings/runs" />
      <div className="runs-panel">
        <SettingsNav current="apps" />
        <main
          id="main-content"
          aria-label="Apps & sync settings"
          className="runs-content agent-content apps-content"
        >
          <header className="runs-intro">
            <h1 ref={pageHeading} tabIndex={-1}>
              Apps &amp; sync
            </h1>
            <p>
              Read your library in another reader. Your read and starred states stay in sync with
              Brew.
            </p>
          </header>
          <section
            className="agent-card"
            aria-labelledby="apps-server-title"
            aria-busy={access.isPending}
          >
            <div className="agent-card-heading">
              <div>
                <h2 id="apps-server-title">Server URLs</h2>
                <p>Paste the full protocol URL into your reader app.</p>
              </div>
              <Badge tone={settings?.enabled ? 'positive' : ready ? 'neutral' : 'locked'}>
                {settings?.enabled
                  ? 'On'
                  : ready
                    ? 'Off'
                    : access.isPending
                      ? 'Checking'
                      : 'Needs setup'}
              </Badge>
            </div>
            <ReaderUrl label="Google Reader" url={urls.googleReaderUrl} disabled={!ready} />
            <ReaderUrl label="Fever" url={urls.feverUrl} disabled={!ready} />
            <p>
              For another device, use a Brew server address that device can reach. Remote
              connections should use HTTPS.
            </p>
            {access.isPending ? (
              <p role="status">Checking app access…</p>
            ) : access.isError ? (
              <div role="alert">
                <p>Could not load app access.</p>
                <Button variant="secondary" size="sm" onClick={() => void access.refetch()}>
                  Retry app access
                </Button>
              </div>
            ) : !ready ? (
              <p>
                <Badge tone="locked">Server modes</Badge> Open a server instance of Brew to connect
                reader apps. <a href={agentPageHref('/settings/runs#setup-apps')}>App sync setup</a>
              </p>
            ) : null}
          </section>
          <section className="agent-card" aria-labelledby="apps-password-title">
            <div className="agent-card-heading">
              <div>
                <h2 id="apps-password-title">App password</h2>
                <p>
                  One generated password for your reader apps. It allows reading, state changes and
                  subscription management.
                </p>
              </div>
            </div>
            <dl className="apps-username">
              <dt>App username</dt>
              <dd>{settings?.username ?? 'Not configured'}</dd>
            </dl>
            <p>
              {settings?.enabled
                ? 'Your password is stored as a verifier and cannot be shown again. Generate a replacement if you lose it.'
                : 'Generate an app password to turn on reader sync.'}
            </p>
            <div className="apps-actions">
              <Button
                buttonRef={generate}
                variant="secondary"
                size="sm"
                disabled={!ready || access.isFetching}
                data-brew-action="generate-reader-password"
                onClick={(event) => {
                  returnFocus.current = event.currentTarget;
                  setNotice('');
                  setDialog({
                    kind: 'password',
                    enabled: Boolean(settings?.enabled),
                    username: settings?.username ?? 'reader',
                  });
                }}
              >
                {settings?.enabled ? 'Rotate app password' : 'Generate app password'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!ready || !settings?.enabled || access.isFetching}
                data-brew-action="disable-reader-access"
                onClick={(event) => {
                  returnFocus.current = event.currentTarget;
                  setNotice('');
                  setDialog({
                    kind: 'disable',
                    enabled: true,
                    username: settings?.username ?? 'reader',
                  });
                }}
              >
                Disable app access
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!ready || access.isFetching}
                onClick={() => void access.refetch()}
              >
                Check app access
              </Button>
            </div>
            <p role="status" aria-label="App access result">
              {notice ||
                (settings
                  ? settings.enabled
                    ? 'Reader app access is on.'
                    : 'Reader app access is off.'
                  : '')}
            </p>
          </section>
          <section className="agent-card" aria-labelledby="apps-clients-title">
            <div>
              <h2 id="apps-clients-title">Connect an app</h2>
              <p>Use the app username and password generated here in each reader.</p>
            </div>
            <div className="apps-clients">
              {readerAppClients.map((app) => (
                <section key={app.name} aria-label={`${app.name} setup`}>
                  <div className="apps-client-heading">
                    <h3>{app.name}</h3>
                    <Badge tone="neutral">{app.account}</Badge>
                  </div>
                  <ol>
                    {app.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  <a href={app.guide} target="_blank" rel="noreferrer">
                    {app.name} guide
                  </a>
                </section>
              ))}
            </div>
          </section>
          {dialog && (
            <ReaderAccessDialog
              kind={dialog.kind}
              enabled={dialog.enabled}
              username={dialog.username}
              returnFocusRef={returnFocus}
              onClose={() => setDialog(null)}
              refresh={refresh}
              onComplete={(message) => {
                setNotice(message);
                if (dialog.kind === 'disable') {
                  focusAfterDisable.current = true;
                  returnFocus.current = generate.current;
                  setDialog(null);
                }
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function ReaderUrl({ label, url, disabled }: { label: string; url: string; disabled: boolean }) {
  const [notice, setNotice] = useState('');
  return (
    <div className="apps-url">
      <div className="agent-endpoint" role="group" aria-label={`${label} server URL`}>
        <span>{label}</span>
        <code>{url}</code>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Copy ${label} URL`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setNotice(`${label} URL copied.`);
            } catch {
              setNotice(`Could not copy. Select the ${label} URL to copy it manually.`);
            }
          }}
        >
          <span className="agent-copy-icon">
            <img src="/figma/agents/611cd.svg" alt="" />
          </span>
        </button>
      </div>
      <p role="status" aria-label={`${label} copy result`}>
        {notice}
      </p>
    </div>
  );
}

function ReaderAccessDialog({
  kind,
  enabled,
  username,
  returnFocusRef,
  onClose,
  refresh,
  onComplete,
}: {
  kind: 'password' | 'disable';
  enabled: boolean;
  username: string;
  returnFocusRef: RefObject<HTMLElement>;
  onClose: () => void;
  refresh: () => void;
  onComplete: (message: string) => void;
}) {
  const [name, setName] = useState(username);
  const [secret, setSecret] = useState<{ username: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false),
    alive = useRef(true);
  const cancel = useRef<HTMLButtonElement>(null),
    input = useRef<HTMLInputElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    if (secret) heading.current?.focus();
  }, [secret]);
  const disabling = kind === 'disable';
  const title = disabling
    ? 'Disable app access?'
    : enabled
      ? 'Rotate app password'
      : 'Generate app password';
  const close = () => {
    if (!pending.current) onClose();
  };
  const submit = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await changeReaderAccess(disabling ? undefined : name);
      refresh();
      if (!alive.current) return;
      if (result) {
        setSecret(result);
        onComplete('New app password generated. Update each connected reader.');
      } else onComplete('Reader app access disabled.');
    } catch (failure) {
      refresh();
      if (alive.current)
        setError(
          `${(failure as Error).message} ${disabling ? 'Check access before trying again.' : 'The request may have completed. Generating again replaces the current password and disconnects readers.'}`,
        );
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <ModalSheet
      open
      title={title}
      onClose={close}
      returnFocusRef={returnFocusRef}
      initialFocusRef={disabling || enabled ? cancel : input}
      description={
        disabling
          ? 'Disconnect every reader app from this Brew instance. Your feeds, articles and reading state stay in Brew.'
          : enabled
            ? 'Replace the current password and disconnect every reader app. Enter the new password in each app to reconnect.'
            : 'Generate a password for reading, changing read and starred states, and managing subscriptions in your reader apps.'
      }
    >
      {secret ? (
        <div className="agent-token-secret apps-password-secret">
          <h3 ref={heading} tabIndex={-1}>
            Copy your app password now
          </h3>
          <p>
            This is the only time it is shown. Save it in your reader apps. If you lose it, generate
            a replacement.
          </p>
          <p>
            App username: <strong>{secret.username}</strong>
          </p>
          <CodeBlock code={secret.password} label="New reader app password" copyable />
          <Button onClick={close}>Done</Button>
        </div>
      ) : (
        <form
          className="apps-password-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {!disabling && (
            <Input
              label="App username"
              inputRef={input}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
              maxLength={100}
              pattern="[a-zA-Z0-9@._+\-]+"
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          )}
          {!disabling && (
            <p>
              Use 1–100 letters, digits, @, period, underscore, plus or hyphen. Brew generates the
              password.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="apps-actions">
            <Button buttonRef={cancel} variant="secondary" disabled={busy} onClick={close}>
              {disabling ? 'Keep app access' : 'Cancel'}
            </Button>
            <Button
              type="submit"
              disabled={busy}
              data-brew-action={
                disabling ? 'confirm-disable-reader-access' : 'confirm-generate-reader-password'
              }
            >
              {busy
                ? disabling
                  ? 'Disabling…'
                  : 'Generating…'
                : disabling
                  ? 'Disable app access'
                  : error
                    ? 'Generate again'
                    : enabled
                      ? 'Rotate app password'
                      : 'Generate app password'}
            </Button>
          </div>
        </form>
      )}
    </ModalSheet>
  );
}
