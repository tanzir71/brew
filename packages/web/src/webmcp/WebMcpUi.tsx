import { useRef, useState } from 'react';
import type { AgentToolResult } from '@brew/core/agent-tools';
import type { ActionReceipt } from '@brew/core/actions';
import type { ReadActionPreview } from '@brew/core/read-actions';
import { ModalSheet } from '../components/Sheet';
import { Button } from '../components/controls';
import { CodeBlock } from '../components/patterns';
import { useClock } from '../hooks/useClock';
import { useWebMcpSurface } from './useWebMcpSurface';

export interface ToolReview {
  name: string;
  input: Record<string, unknown>;
  signal: AbortSignal;
  readPreview?: ReadActionPreview;
  finish: (approved: boolean) => void;
}
const titles: Record<string, string> = {
  mark_read: 'Mark articles read?',
  star: 'Change starred state?',
  tag: 'Change article tags?',
  add_feed: 'Subscribe to this feed?',
  create_rule: 'Save this rule?',
  undo: 'Undo this change?',
};
export function WebMcpReview({ request }: { request: ToolReview }) {
  const cancel = useRef<HTMLButtonElement>(null);
  const details = Object.fromEntries(
    Object.entries(request.input).filter(
      ([key]) => !['confirm', 'request_id', 'revision'].includes(key),
    ),
  );
  if (request.name === 'star' && details.starred === undefined) details.starred = true;
  return (
    <ModalSheet
      open
      title={titles[request.name] ?? 'Review agent action'}
      description="An in-page agent requested this change. Review it before allowing the write."
      onClose={() => request.finish(false)}
      initialFocusRef={cancel}
      footer={
        <>
          <Button buttonRef={cancel} variant="secondary" onClick={() => request.finish(false)}>
            Cancel action
          </Button>
          <Button data-brew-action="confirm-webmcp-action" onClick={() => request.finish(true)}>
            {request.readPreview ? `Mark ${request.readPreview.updated} read` : 'Confirm change'}
          </Button>
        </>
      }
    >
      {request.readPreview && (
        <p className="mb-3 text-sm text-soft">
          This scope currently contains {request.readPreview.updated} unread{' '}
          {request.readPreview.updated === 1 ? 'article' : 'articles'}.
          {request.readPreview.unavailable > 0 &&
            ` ${request.readPreview.unavailable} articles are unavailable.`}
        </p>
      )}
      <CodeBlock code={JSON.stringify(details, null, 2)} label="Requested changes" />
      <p className="mt-3 text-sm text-soft">
        Undo can restore local changes for 30 seconds while they remain unchanged.
        {request.name === 'create_rule' &&
          ' An enabled rule can run its configured actions when future articles arrive.'}
      </p>
    </ModalSheet>
  );
}
export function WebMcpResult({
  name,
  value,
  onDismiss,
  onUndo,
}: {
  name: string;
  value: AgentToolResult;
  onDismiss: () => void;
  onUndo: (receipt: ActionReceipt) => Promise<void>;
}) {
  const root = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const now = useClock();
  const receipt = value.structuredContent?.receipt as ActionReceipt | undefined;
  const canUndo =
    receipt?.canUndo && Boolean(receipt.expiresAt && Date.parse(receipt.expiresAt) > now);
  useWebMcpSurface(
    root,
    { names: ['undo'], ids: receipt ? [receipt.id] : [] },
    Boolean(canUndo) && !busy,
  );
  return (
    <section
      ref={root}
      className="brew-undo-toast webmcp-result"
      tabIndex={-1}
      aria-label="In-page agent result"
      aria-live="polite"
      aria-atomic="true"
    >
      <p>
        {receipt
          ? receipt.status === 'undone'
            ? 'Undid local changes.'
            : receipt.summary
          : value.isError
            ? String(value.structuredContent?.error ?? 'The tool could not complete.')
            : name === 'create_rule'
              ? `Rule preview: ${value.structuredContent?.total ?? value.structuredContent?.matched ?? 0} matches.`
              : 'In-page tool completed.'}
      </p>
      {canUndo && (
        <Button
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            if (!receipt || busy) return;
            setBusy(true);
            setError('');
            try {
              await onUndo(receipt);
              root.current?.focus({ preventScroll: true });
            } catch (failure) {
              setError((failure as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Undo agent change
        </Button>
      )}
      <Button
        variant="ghost"
        onClick={() => {
          document.querySelector<HTMLElement>('main h1[tabindex]')?.focus({ preventScroll: true });
          onDismiss();
        }}
      >
        Dismiss agent result
      </Button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
