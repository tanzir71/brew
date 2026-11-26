import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentActivity as Activity } from '@brew/core/agent-access';
import { Button } from '../components/controls';
import { ModalSheet } from '../components/Sheet';
import { refreshArticleStates } from '../articleState';
import { agentAccessRequest, activityKey } from './agentAccessApi';
import { useClock } from '../hooks/useClock';

type Page = { items: Activity[]; next: number | null };
export function AgentActivity({ available }: { available: boolean }) {
  const now = useClock();
  const [full, setFull] = useState(false);
  const [cursors, setCursors] = useState<Array<number | undefined>>([undefined]);
  const cursor = cursors[cursors.length - 1];
  const recent = useQuery({
    queryKey: [...activityKey, undefined],
    enabled: available,
    queryFn: ({ signal }) => agentAccessRequest<Page>('/api/agent-access/actions', { signal }),
    refetchInterval: 2000,
  });
  const page = useQuery({
    queryKey: [...activityKey, cursor],
    enabled: available && full,
    queryFn: ({ signal }) =>
      agentAccessRequest<Page>(`/api/agent-access/actions${cursor ? `?before=${cursor}` : ''}`, {
        signal,
      }),
    refetchInterval: cursor ? false : 2000,
  });
  const fullButton = useRef<HTMLButtonElement>(null);
  const render = (query: typeof recent, all = false) =>
    query.isError ? (
      <div role="alert">
        <p>Could not load agent actions.</p>
        <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
          Retry actions
        </Button>
      </div>
    ) : (
      <ul
        className="agent-activity-list"
        aria-label={all ? 'Agent action log' : 'Recent agent actions'}
        aria-busy={query.isPending}
      >
        {(all ? query.data?.items : query.data?.items.slice(0, 4))?.map((item) => (
          <ActivityRow key={item.id} item={item} now={now} />
        ))}
        {!query.data?.items.length && (
          <li>
            {query.isPending
              ? 'Loading actions…'
              : 'No agent actions yet. Connect an agent to start your log.'}
          </li>
        )}
      </ul>
    );
  return (
    <section className="agent-card" aria-labelledby="agent-activity-title">
      <div className="agent-card-heading">
        <div>
          <h2 id="agent-activity-title">Recent agent actions</h2>
          <p>
            Writes require a write token and explicit confirmation. Undo is available for 30
            seconds.
          </p>
        </div>
        <Button
          buttonRef={fullButton}
          variant="ghost"
          size="sm"
          disabled={!available}
          onClick={() => {
            setCursors([undefined]);
            setFull(true);
          }}
          icon={<img src="/figma/agents/3ac7a.svg" alt="" />}
        >
          Full log
        </Button>
      </div>
      {available ? render(recent) : <p>Connect a supported instance to keep an action log.</p>}
      <ModalSheet
        open={full}
        title="Agent action log"
        description="Private arguments and article content are omitted. Undo restores actual local changes while they remain unchanged."
        onClose={() => setFull(false)}
        returnFocusRef={fullButton}
      >
        {render(page, true)}
        <div className="agent-log-paging">
          <Button
            variant="secondary"
            size="sm"
            disabled={cursors.length < 2}
            onClick={() => setCursors((value) => value.slice(0, -1))}
          >
            Newer actions
          </Button>
          <span role="status">Page {cursors.length}</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={!page.data?.next || page.isFetching}
            onClick={() => {
              if (page.data?.next) setCursors((value) => [...value, page.data!.next!]);
            }}
          >
            Older actions
          </Button>
        </div>
      </ModalSheet>
    </section>
  );
}
function ActivityRow({ item, now }: { item: Activity; now: number }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [undone, setUndone] = useState(false);
  const result = useRef<HTMLParagraphElement>(null);
  const receipt = item.receipt;
  const canUndo =
    receipt?.canUndo && !undone && (!receipt.expiresAt || Date.parse(receipt.expiresAt) > now);
  return (
    <li data-brew-kind="agent-action" data-brew-id={item.id}>
      <time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString()}>
        {new Date(item.createdAt).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })}
      </time>
      <span className="agent-chip">
        <img src="/figma/agents/c58e4.svg" alt="" />
        {item.agent}
      </span>
      <p>{item.summary}</p>
      {canUndo ? (
        <button
          type="button"
          disabled={busy}
          className="agent-undo"
          data-brew-action="undo-agent-action"
          aria-label={`Undo action ${item.id}`}
          onClick={async (event) => {
            if (busy) return;
            const trigger = event.currentTarget;
            setBusy(true);
            setError('');
            try {
              await agentAccessRequest(`/api/actions/${item.id}/undo`, {
                method: 'POST',
                body: '{}',
              });
              setUndone(true);
              refreshArticleStates(client);
              await client.invalidateQueries({ queryKey: activityKey });
            } catch (failure) {
              setError((failure as Error).message);
            } finally {
              setBusy(false);
              requestAnimationFrame(() => {
                if (document.activeElement === trigger || document.activeElement === document.body)
                  result.current?.focus({ preventScroll: true });
              });
            }
          }}
        >
          {busy ? 'Undoing…' : 'Undo'}
        </button>
      ) : (
        receipt && (
          <span className="text-soft">
            {undone || receipt.status === 'undone'
              ? 'Undone'
              : receipt.canUndo
                ? 'Undo expired'
                : 'Finished'}
          </span>
        )
      )}
      <p
        ref={result}
        tabIndex={-1}
        role={error ? 'alert' : 'status'}
        className={error || undone ? 'agent-action-result' : 'sr-only'}
      >
        {error || (undone ? 'Action undone.' : '')}
      </p>
    </li>
  );
}
