import { useLayoutEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RuleLogPage } from '@brew/core/types/rules';
import { rulePageHref } from '@brew/core/app-pages';
import { textTwinHref } from '@brew/core/reader-pages';
import { agentPageHref } from '../agentLocation';
import { PageControls } from '../components/PageControls';

export function RuleHistory({
  id,
  page,
  onPage,
}: {
  id: number;
  page: number;
  onPage: (page: number, href: string) => void;
}) {
  const query = useQuery({
    queryKey: ['rule-logs', id, page],
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/rules/${id}/executions?page=${page}`, {
        signal,
        cache: 'no-store',
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? 'Could not load executions.');
      return value as RuleLogPage;
    },
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<{ page: number; href: string; trigger: HTMLElement } | null>(null);
  const href = (value: number) => agentPageHref(rulePageHref(id, 'log', value));
  useLayoutEffect(() => {
    const ticket = pendingFocus.current;
    if (!ticket) return;
    if (ticket.page !== page || ticket.href !== location.pathname + location.search) {
      pendingFocus.current = null;
      return;
    }
    if (query.isFetching || query.isPending) return;
    pendingFocus.current = null;
    const frame = requestAnimationFrame(() => {
      if (
        ticket.href === location.pathname + location.search &&
        !document.querySelector('dialog:modal') &&
        (document.activeElement === document.body || document.activeElement === ticket.trigger)
      )
        heading.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [id, page, query.isFetching, query.isPending, query.status]);
  const navigate = (target: string, value: number, trigger: HTMLElement) => {
    pendingFocus.current = { page: value, href: target, trigger };
    onPage(value, target);
  };
  const data = query.data;
  const from = data?.items.length ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data?.items.length ? from + data.items.length - 1 : 0;
  return (
    <section
      className="mt-7 border-t border-line pt-5"
      aria-label="Rule execution log"
      aria-busy={query.isFetching}
    >
      <h2 ref={heading} tabIndex={-1} className="text-sm font-semibold">
        Recent executions
      </h2>
      {query.isFetching && (
        <p role="status" aria-label="Rule log loading">
          Loading executions…
        </p>
      )}
      {query.isError && (
        <div role="alert" className="text-xs text-danger">
          Could not load executions. {data && 'Previously loaded executions are shown.'}
          <button
            type="button"
            data-brew-action="retry-rule-executions"
            className="brew-compact-control block text-accent"
            onClick={(event) => {
              pendingFocus.current = {
                page,
                href: location.pathname + location.search,
                trigger: event.currentTarget,
              };
              void query.refetch();
            }}
          >
            Retry executions
          </button>
        </div>
      )}
      {data && (
        <>
          <p
            role="status"
            aria-label="Execution range"
            aria-live="polite"
            aria-atomic="true"
            className="mt-3 text-xs text-soft"
          >
            Showing {from}–{to} of {data.total} executions
            {(query.isError || query.isFetching) && ' · Last loaded'}
          </p>
          {!query.isFetching && !query.isError && !data.items.length && (
            <p className="mt-3 text-xs text-soft">
              {data.total ? 'No executions on this page.' : 'No executions yet.'}
            </p>
          )}
          <div className="mt-3 max-h-72 space-y-3 overflow-auto">
            {data.items.map((log) => (
              <article
                key={log.id}
                aria-label={log.articleTitle}
                data-brew-id={log.id}
                data-brew-kind="rule-log"
                data-brew-state="executed"
                className="text-xs"
              >
                <a
                  data-brew-action="open-rule-execution"
                  className="brew-compact-control font-medium"
                  href={agentPageHref(`/a/${log.articleId}`)}
                >
                  {log.articleTitle}
                </a>
                <p className="text-muted">{new Date(log.executedAt).toLocaleString()}</p>
                <p className="text-soft">
                  {log.actions
                    .map((action) => `${action.type}: ${action.ok ? 'ok' : action.error}`)
                    .join(', ')}
                </p>
              </article>
            ))}
          </div>
          <div className="mt-4 space-y-3">
            <PageControls
              page={page}
              pageSize={data.pageSize}
              total={data.total}
              href={href}
              navigate={navigate}
              label="Execution pages"
              action="rule-execution-page"
            />
            {page > 1 && !data.items.length && (
              <a
                className="brew-compact-control block text-xs text-accent"
                href={href(1)}
                onClick={(event) => {
                  if (
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  )
                    return;
                  event.preventDefault();
                  navigate(event.currentTarget.getAttribute('href')!, 1, event.currentTarget);
                }}
              >
                First page
              </a>
            )}
            <nav aria-label="Execution text formats" className="flex gap-3 text-xs">
              {(['md', 'json'] as const).map((format) => (
                <a
                  key={format}
                  className="brew-compact-control text-accent"
                  href={textTwinHref(href(page), format)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {format === 'md' ? 'Markdown' : 'JSON'}
                </a>
              ))}
            </nav>
          </div>
        </>
      )}
    </section>
  );
}
