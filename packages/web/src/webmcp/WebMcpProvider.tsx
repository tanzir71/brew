import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { AgentToolResult } from '@brew/core/agent-tools';
import type { ActionReceipt } from '@brew/core/actions';
import type { ReadActionPreview } from '@brew/core/read-actions';
import { useCapabilities } from '../hooks/useCapabilities';
import { useBrowserPreferences } from '../hooks/useBrowserPreferences';
import { refreshArticleStates } from '../articleState';
import { WebMcpRuntime, browserJson, toolError } from './runtime';
import { WebMcpContext } from './context';
import { WebMcpReview, WebMcpResult, type ToolReview } from './WebMcpUi';

const needsReview = (name: string, input: Record<string, unknown>) =>
  input.confirm === true &&
  (['mark_read', 'star', 'tag', 'add_feed', 'undo'].includes(name) ||
    (name === 'create_rule' && input.dry_run === false));
function refreshOwnerState(client: QueryClient) {
  refreshArticleStates(client);
  for (const key of [
    'source-feeds',
    'source-folders',
    'feeds',
    'folders',
    'tags',
    'saved-rules',
    'brew-configs',
    'brew-history',
    'agent-activity',
  ])
    void client.invalidateQueries({ queryKey: [key] });
}
export function WebMcpProvider({ children }: { children: ReactNode }) {
  const caps = useCapabilities();
  const preferences = useBrowserPreferences();
  const client = useQueryClient();
  const [review, setReview] = useState<ToolReview | null>(null);
  const [result, setResult] = useState<{ name: string; value: AgentToolResult } | null>(null);
  const [generation, setGeneration] = useState(0);
  const [runtime] = useState(() => {
    let currentReview: ToolReview | null = null;
    let preparingReview = false;
    return new WebMcpRuntime(async (name, input, signal) => {
      if (currentReview || preparingReview)
        return toolError('Finish the current review before starting another tool.');
      if (needsReview(name, input)) {
        preparingReview = true;
        let approved: boolean;
        try {
          let readPreview: ReadActionPreview | undefined;
          if (name === 'mark_read') {
            const preview = await browserJson<AgentToolResult>('/api/webmcp/call', signal, {
              name,
              arguments: { target: input.target },
            });
            if (preview.isError) return preview;
            readPreview = preview.structuredContent as unknown as ReadActionPreview;
          }
          approved = await new Promise<boolean>((resolve) => {
            let settled = false;
            const finish = (confirmed: boolean) => {
              if (settled) return;
              settled = true;
              signal.removeEventListener('abort', cancel);
              currentReview = null;
              setReview(null);
              resolve(confirmed);
            };
            const cancel = () => finish(false);
            const request = { name, input, signal, finish, readPreview };
            currentReview = request;
            setReview(request);
            signal.addEventListener('abort', cancel, { once: true });
            if (signal.aborted) cancel();
          });
        } finally {
          preparingReview = false;
        }
        if (!approved || signal.aborted)
          return toolError('The action was cancelled. No new write was requested.');
      }
      let value: AgentToolResult;
      try {
        value = await browserJson<AgentToolResult>('/api/webmcp/call', signal, {
          name,
          arguments: input,
        });
      } catch (failure) {
        if (signal.aborted) throw failure;
        value = toolError(
          'Could not confirm the tool’s result. The agent can retry this request.',
          503,
        );
        value.content[0]!.text += ' For writes, preserve the same request_id.';
      }
      if (!signal.aborted) setResult({ name, value });
      if (!value.isError && (value.structuredContent?.receipt || needsReview(name, input)))
        refreshOwnerState(client);
      return value;
    });
  });
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  const enabled = caps.data?.webmcp === true && preferences.values.webmcp === 'true';
  useEffect(() => {
    if (enabled) void runtime.start();
    else runtime.stop();
    const suspend = () => runtime.stop();
    const resume = (event: PageTransitionEvent) => {
      if (event.persisted && enabled) void runtime.start();
    };
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', resume);
    return () => {
      window.removeEventListener('pagehide', suspend);
      window.removeEventListener('pageshow', resume);
      runtime.stop();
    };
  }, [enabled, generation, runtime]);
  const retry = () => setGeneration((value) => value + 1);
  return (
    <WebMcpContext.Provider value={{ runtime, active: enabled, state, retry }}>
      {children}
      {review && <WebMcpReview request={review} />}
      {enabled && result && (
        <WebMcpResult
          name={result.name}
          value={result.value}
          onDismiss={() => setResult(null)}
          onUndo={async (receipt: ActionReceipt) => {
            const controller = new AbortController();
            const value = await browserJson<AgentToolResult>(
              '/api/webmcp/call',
              controller.signal,
              { name: 'undo', arguments: { undo_id: receipt.id, confirm: true } },
            );
            setResult({ name: 'undo', value });
            if (!value.isError) refreshOwnerState(client);
          }}
        />
      )}
    </WebMcpContext.Provider>
  );
}
