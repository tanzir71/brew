import { useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentToken } from '@brew/core/agent-access';
import { Badge } from '../components/Badge';
import { Button } from '../components/controls';
import { ModalSheet } from '../components/Sheet';
import { CodeBlock } from '../components/patterns';
import { agentAccessRequest, tokenKey } from './agentAccessApi';
import { useClock } from '../hooks/useClock';
import { agentPageHref } from '../agentLocation';

const dateLabel = (value: string) =>
  new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const lastUsed = (value: string, now: number) => {
  const date = new Date(value),
    today = new Date(now);
  if (date.toDateString() === today.toDateString())
    return `Today, ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  if (date.toDateString() === new Date(now - 86400000).toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
};
export function AgentTokens({ available }: { available: boolean }) {
  const now = useClock(30_000);
  const client = useQueryClient();
  const tokens = useQuery({
    queryKey: tokenKey,
    enabled: available,
    queryFn: ({ signal }) =>
      agentAccessRequest<AgentToken[]>('/api/agent-access/tokens', { signal }),
    refetchInterval: 30_000,
  });
  const [open, setOpen] = useState(false);
  const [revoke, setRevoke] = useState<AgentToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const newButton = useRef<HTMLButtonElement>(null);
  const revokeTrigger = useRef<HTMLButtonElement | null>(null);
  return (
    <section className="agent-card" aria-labelledby="agent-tokens-title">
      <div className="agent-card-heading">
        <div>
          <h2 id="agent-tokens-title">Tokens</h2>
          <p>Read-only by default. Write tokens can mark, star, tag and add feeds, never delete.</p>
        </div>
        <Button
          buttonRef={newButton}
          variant="secondary"
          size="sm"
          disabled={!available}
          data-brew-action="new-agent-token"
          onClick={() => setOpen(true)}
          icon={<img src="/figma/agents/2d1f8.svg" alt="" />}
        >
          New token
        </Button>
      </div>
      {!available ? (
        <p>
          <Badge tone="locked">Needs setup</Badge>{' '}
          <a href={agentPageHref('/settings/runs#setup-agents')}>Set up agent access</a>
        </p>
      ) : tokens.isError ? (
        <div role="alert">
          <p>Could not load tokens.</p>
          <Button variant="secondary" size="sm" onClick={() => void tokens.refetch()}>
            Retry tokens
          </Button>
        </div>
      ) : (
        <div className="agent-table-scroll" tabIndex={0} role="region" aria-label="Agent tokens">
          <table className="agent-token-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Access</th>
                <th scope="col">Last used</th>
                <th scope="col">Expires</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tokens.data?.map((token) => (
                <tr key={token.id} data-brew-kind="agent-token" data-brew-id={token.id}>
                  <th scope="row">{token.name}</th>
                  <td>
                    <Badge tone={token.scopes === 'write' ? 'warning' : 'neutral'}>
                      {token.scopes === 'write' ? 'Read & write' : 'Read-only'}
                    </Badge>
                  </td>
                  <td>
                    {token.lastUsedAt ? (
                      <time dateTime={token.lastUsedAt} title={dateLabel(token.lastUsedAt)}>
                        {lastUsed(token.lastUsedAt, now)}
                      </time>
                    ) : (
                      'Never'
                    )}
                  </td>
                  <td>
                    <time dateTime={token.expiresAt} title={dateLabel(token.expiresAt)}>
                      {Date.parse(token.expiresAt) <= now
                        ? 'Expired'
                        : `In ${Math.ceil((Date.parse(token.expiresAt) - now) / 86400000)} days`}
                    </time>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="agent-revoke"
                      aria-label={`Revoke ${token.name}`}
                      data-brew-action="revoke-agent-token"
                      onClick={(event) => {
                        revokeTrigger.current = event.currentTarget;
                        setRevoke(token);
                        setError('');
                      }}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
              {!tokens.data?.length && (
                <tr>
                  <td colSpan={5}>
                    {tokens.isPending
                      ? 'Loading tokens…'
                      : 'No tokens yet. Create a read-only token to connect your first agent.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      <NewToken
        open={open}
        onClose={() => setOpen(false)}
        onCreated={() => void client.invalidateQueries({ queryKey: tokenKey })}
        returnFocusRef={newButton}
      />
      <ModalSheet
        open={revoke !== null}
        title="Revoke token"
        returnFocusRef={revokeTrigger}
        description={`Disconnect ${revoke?.name ?? 'this agent'} immediately. Its past actions stay in the log.`}
        onClose={() => {
          if (!busy) setRevoke(null);
        }}
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setRevoke(null)}>
              Keep token
            </Button>
            <Button
              disabled={busy}
              data-brew-action="confirm-revoke-agent-token"
              onClick={async () => {
                if (!revoke || busy) return;
                setBusy(true);
                setError('');
                try {
                  await agentAccessRequest(`/api/agent-access/tokens/${revoke.id}`, {
                    method: 'DELETE',
                  });
                  setNotice(`Revoked ${revoke.name}.`);
                  setRevoke(null);
                  await client.invalidateQueries({ queryKey: tokenKey });
                  if (
                    document.activeElement === document.body ||
                    document.activeElement === revokeTrigger.current
                  )
                    newButton.current?.focus({ preventScroll: true });
                } catch (failure) {
                  setError((failure as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Revoking…' : 'Revoke token'}
            </Button>
          </>
        }
      >
        {error && <p role="alert">{error}</p>}
      </ModalSheet>
    </section>
  );
}
function NewToken({
  open,
  onClose,
  onCreated,
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  returnFocusRef: React.RefObject<HTMLButtonElement>;
}) {
  return (
    <ModalSheet
      open={open}
      title="New token"
      description="Give each agent its own token. You can revoke it at any time."
      onClose={onClose}
      returnFocusRef={returnFocusRef}
    >
      <TokenForm onCreated={onCreated} onClose={onClose} />
    </ModalSheet>
  );
}
function TokenForm({ onCreated, onClose }: { onCreated: () => void; onClose: () => void }) {
  const id = useId();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState('read');
  const [days, setDays] = useState('30');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const secretHeading = useRef<HTMLHeadingElement>(null);
  // Secret lives only in this mounted form, never in a query cache or browser storage.
  if (secret)
    return (
      <div className="agent-token-secret">
        <h3 ref={secretHeading} tabIndex={-1}>
          Copy your token now
        </h3>
        <p>
          This is the only time it is shown. Save it in your client’s secret settings. If you lose
          it, revoke this token and create another.
        </p>
        <CodeBlock code={secret} label="New agent token" copyable />
        <Button onClick={onClose}>Done</Button>
      </div>
    );
  return (
    <form
      className="agent-token-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        try {
          const result = await agentAccessRequest<{ token: string }>('/api/agent-access/tokens', {
            method: 'POST',
            body: JSON.stringify({ name, scopes, expiresInDays: Number(days) }),
          });
          setSecret(result.token);
          onCreated();
          requestAnimationFrame(() => secretHeading.current?.focus());
        } catch (failure) {
          setError((failure as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Token name
        <input
          autoFocus
          required
          maxLength={100}
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Codex CLI"
        />
      </label>
      <label htmlFor={`${id}-scope`}>
        <span>Access</span>
        <select
          id={`${id}-scope`}
          aria-label="Access"
          value={scopes}
          onChange={(e) => setScopes(e.target.value)}
        >
          <option value="read">Read-only</option>
          <option value="write">Read &amp; write</option>
        </select>
      </label>
      <p>
        Read-only can search, read and preview. Write also allows confirmed mark, star, tag and
        add-feed actions, and Undo of that token’s own changes. Tokens cannot delete library content
        or save rules.
      </p>
      <label htmlFor={`${id}-expiry`}>
        <span>Expires in</span>
        <select
          id={`${id}-expiry`}
          aria-label="Expires in"
          value={days}
          onChange={(e) => setDays(e.target.value)}
        >
          <option value="7">7 days</option>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      <Button type="submit" disabled={busy} data-brew-action="create-agent-token">
        {busy ? 'Creating…' : 'Create token'}
      </Button>
    </form>
  );
}
