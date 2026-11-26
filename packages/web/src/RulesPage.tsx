import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useOwnerActions } from './hooks/useOwnerActions';
import { OwnerActionUi } from './components/OwnerActionUi';
import { rulePageHref, rulePageLocation } from '@brew/core/app-pages';
import { usePageAlternates } from './hooks/usePageAlternates';
import type { ReaderNavigation } from '@brew/core/types/api';
import type {
  RuleAction,
  RuleCondition,
  RuleDraft,
  RuleField,
  RuleLogRecord,
  RuleOperator,
  RulePreviewItem,
  RuleRecord,
} from '@brew/core/types/rules';

const fields: RuleField[] = ['title', 'content', 'author', 'url', 'feed', 'folder'];
const operators: RuleOperator[] = [
  'contains',
  'not_contains',
  'equals',
  'starts_with',
  'ends_with',
  'matches_regex',
];
const actionTypes: RuleAction['type'][] = [
  'add_tag',
  'remove_tag',
  'star',
  'mark_read',
  'hide',
  'highlight',
  'feature_in_brew',
  'exclude_from_brew',
  'notify',
  'webhook',
];
const actionLabels: Record<RuleAction['type'], string> = {
  add_tag: 'tag it',
  remove_tag: 'remove tag',
  star: 'star it',
  mark_read: 'mark it read',
  hide: 'hide it',
  highlight: 'highlight it',
  feature_in_brew: 'feature it in the Brew',
  exclude_from_brew: 'exclude it from the Brew',
  notify: 'notify me',
  webhook: 'send a webhook',
};
const blankDraft = (): RuleDraft => ({
  name: 'New rule',
  enabled: true,
  matchType: 'all',
  scope: {},
  conditions: [{ field: 'title', operator: 'contains', value: '' }],
  actions: [{ type: 'star' }],
  stopProcessing: false,
});
const inputClass =
  'rounded-lg border border-line-strong bg-surface px-2.5 py-2 text-sm outline-none focus:border-ink';
const savedDraft = (rule: RuleRecord): RuleDraft => ({
  name: rule.name, enabled: rule.enabled, matchType: rule.matchType,
  scope: structuredClone(rule.scope), conditions: structuredClone(rule.conditions),
  actions: structuredClone(rule.actions), stopProcessing: rule.stopProcessing, position: rule.position,
});
function writeRuleLocation(id: number | null, tab: 'preview' | 'log') {
  const href = rulePageHref(id, tab);
  if (location.pathname + location.search !== href) history.pushState(null, '', href);
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: 'Request failed' }))) as {
      error?: string;
    };
    throw new Error(body.error ?? 'Request failed');
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}

export function RulesPage() {
  const [rules, setRules] = useState<RuleRecord[]>([]);
  const [navigation, setNavigation] = useState<ReaderNavigation>({
    counts: { all: 0, today: 0, starred: 0 },
    folders: [],
    unfiled: [],
  });
  const [selectedId, setSelectedId] = useState<number | null>(() => rulePageLocation(new URL(location.href)).id);
  const [tab, setTab] = useState(() => rulePageLocation(new URL(location.href)).tab);
  usePageAlternates(rulePageHref(selectedId, selectedId === null ? 'preview' : tab), 'Saved rules');
  const [draft, setDraft] = useState<RuleDraft>(blankDraft);
  const [preview, setPreview] = useState<RulePreviewItem[]>([]);
  const [previewError, setPreviewError] = useState('');
  const [message, setMessage] = useState('');
  const [logs, setLogs] = useState<RuleLogRecord[]>([]);
  const [duplicateFilter, setDuplicateFilter] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    typeof Notification === 'undefined' ? 'denied' : Notification.permission,
  );
  const refresh = useCallback(async () => {
    const [nextRules, nextNavigation, filter] = await Promise.all([
      json<RuleRecord[]>('/api/rules'),
      json<ReaderNavigation>('/api/reader/navigation'),
      json<{ enabled: boolean }>('/api/rules/duplicate-filter'),
    ]);
    setRules(nextRules);
    setNavigation(nextNavigation);
    setDuplicateFilter(filter.enabled);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      json<RuleRecord[]>('/api/rules', { signal: controller.signal }),
      json<ReaderNavigation>('/api/reader/navigation', { signal: controller.signal }),
      json<{ enabled: boolean }>('/api/rules/duplicate-filter', { signal: controller.signal }),
    ])
      .then(([nextRules, nextNavigation, filter]) => {
        if (controller.signal.aborted) return;
        setRules(nextRules);
        setNavigation(nextNavigation);
        setDuplicateFilter(filter.enabled);
        const route = rulePageLocation(new URL(location.href));
        if (route.id !== null) {
          const selected = nextRules.find((rule) => rule.id === route.id);
          if (selected) setDraft(savedDraft(selected));
          else setMessage('Rule not found.');
          if (selected && route.tab === 'log') void json<RuleLogRecord[]>(`/api/rules/${selected.id}/logs`).then((items) => { const current = rulePageLocation(new URL(location.href)); if (current.id === selected.id && current.tab === 'log') setLogs(items); }).catch((error: Error) => { if (rulePageLocation(new URL(location.href)).id === selected.id) setMessage(error.message); });
        }
      })
      .catch((error: Error) => { if (!controller.signal.aborted) setMessage(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const restore = () => {
      const route = rulePageLocation(new URL(location.href));
      setSelectedId(route.id); setTab(route.tab);
      const selected = rules.find((rule) => rule.id === route.id);
      setDraft(selected ? savedDraft(selected) : blankDraft());
      setMessage(route.id !== null && !selected ? 'Rule not found.' : '');
      setLogs([]);
      if (selected && route.tab === 'log') void json<RuleLogRecord[]>(`/api/rules/${selected.id}/logs`).then((items) => { const current = rulePageLocation(new URL(location.href)); if (current.id === selected.id && current.tab === 'log') setLogs(items); }).catch((error: Error) => { if (rulePageLocation(new URL(location.href)).id === selected.id) setMessage(error.message); });
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [rules]);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void json<{ items: RulePreviewItem[] }>('/api/rules/preview', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          scope: draft.scope,
          matchType: draft.matchType,
          conditions: draft.conditions,
        }),
      })
        .then((result) => {
          setPreview(result.items);
          setPreviewError('');
        })
        .catch((error: Error) => {
          if (controller.signal.aborted) return;
          setPreview([]);
          setPreviewError(error.message);
        });
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [draft.conditions, draft.matchType, draft.scope]);
  const owner = useOwnerActions(async (receipt) => {
    await refresh();
    if (receipt.kind === 'delete_rule' && !receipt.undoneAt && selectedId === receipt.targetId) {
      setSelectedId(null); setDraft(blankDraft()); setTab('preview'); writeRuleLocation(null, 'preview');
    }
    if (receipt.kind === 'apply_rule' && rulePageLocation(new URL(location.href)).id === receipt.targetId) { const items = await json<RuleLogRecord[]>(`/api/rules/${receipt.targetId}/logs`); if (rulePageLocation(new URL(location.href)).id === receipt.targetId) setLogs(items); }
  });
  const scopeMode = draft.scope.feedIds?.length
    ? 'feed'
    : draft.scope.folderIds?.length
      ? 'folder'
      : 'all';
  const allFeeds = useMemo(
    () => [...navigation.folders.flatMap((folder) => folder.feeds), ...navigation.unfiled],
    [navigation],
  );
  const selectRule = (rule: RuleRecord, nextTab: 'preview' | 'log' = 'preview') => {
    setSelectedId(rule.id);
    setDraft(savedDraft(rule)); setTab(nextTab); setLogs([]);
    writeRuleLocation(rule.id, nextTab);
    setMessage('');
  };
  const newRule = (next = blankDraft()) => {
    setSelectedId(null); setDraft(next); setTab('preview'); setLogs([]);
    writeRuleLocation(null, 'preview');
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const saved = await json<RuleRecord>(
        selectedId === null ? '/api/rules' : `/api/rules/${selectedId}`,
        { method: selectedId === null ? 'POST' : 'PUT', body: JSON.stringify(draft) },
      );
      selectRule(saved);
      setMessage('Rule saved.');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save rule');
    }
  };
  const remove = (rule: RuleRecord) => {
    setMessage('');
    owner.ask({ kind: 'delete_rule', id: rule.id }, rule.name);
  };
  const duplicate = async (rule: RuleRecord) => {
    const copy: RuleDraft = {
      name: `${rule.name} copy`,
      enabled: false,
      matchType: rule.matchType,
      scope: rule.scope,
      conditions: rule.conditions,
      actions: rule.actions,
      stopProcessing: rule.stopProcessing,
    };
    const created = await json<RuleRecord>('/api/rules', {
      method: 'POST',
      body: JSON.stringify(copy),
    });
    await refresh();
    selectRule(created);
  };
  const showLogs = async (rule: RuleRecord) => {
    selectRule(rule, 'log');
    try { const items = await json<RuleLogRecord[]>(`/api/rules/${rule.id}/logs`); const current = rulePageLocation(new URL(location.href)); if (current.id === rule.id && current.tab === 'log') setLogs(items); }
    catch (error) { setMessage((error as Error).message); }
  };
  const applyExisting = (rule: RuleRecord) => {
    setMessage('');
    owner.ask({ kind: 'apply_rule', id: rule.id, days: 30 }, rule.name, rule.actions.some((action) => ['webhook', 'notify'].includes(action.type)));
  };
  const setCondition = (index: number, values: Partial<RuleCondition>) =>
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.map((condition, item) =>
        item === index ? { ...condition, ...values } : condition,
      ),
    }));
  const setAction = (index: number, action: RuleAction) =>
    setDraft((current) => ({
      ...current,
      actions: current.actions.map((value, item) => (item === index ? action : value)),
    }));

  if (loading) return <p role="status" className="p-12 text-center text-sm text-soft">Loading rules…</p>;
  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-7 py-8 lg:grid-cols-[18rem_minmax(0,1fr)_20rem]">
      <aside>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-soft">
              Automations
            </p>
            <h1 className="mt-1 text-2xl font-semibold">Rules</h1>
          </div>
          <button
            onClick={() => {
              newRule();
            }}
            className="rounded-full bg-inverse px-3 py-2 text-xs font-semibold text-on-inverse"
          >
            New
          </button>
        </div>
        <button
          type="button"
          disabled={typeof Notification === 'undefined' || notificationPermission === 'granted'}
          onClick={() => {
            if (typeof Notification !== 'undefined')
              void Notification.requestPermission().then(setNotificationPermission);
          }}
          className="mt-3 rounded-lg border border-line-strong px-3 py-2 text-xs font-medium text-soft disabled:opacity-60"
        >
          {notificationPermission === 'granted'
            ? 'Notifications enabled'
            : 'Enable notifications'}
        </button>
        <label className="mt-3 flex items-center gap-2 text-xs text-soft">
          <input
            type="checkbox"
            checked={duplicateFilter}
            onChange={(event) => {
              const enabled = event.target.checked;
              setDuplicateFilter(enabled);
              void json('/api/rules/duplicate-filter', { method: 'PUT', body: JSON.stringify({ enabled }) });
            }}
          />
          Hide near-duplicate titles (3 days)
        </label>
        <div className="mt-5 rounded-xl bg-subtle p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-soft">Templates</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={()=>{newRule({...blankDraft(),name:'Mute a keyword',conditions:[{field:'title',operator:'contains',value:'keyword'}],actions:[{type:'hide'}]})}} className="text-xs text-soft">Mute keyword</button>
            <button type="button" onClick={()=>{newRule({...blankDraft(),name:'Highlight an author',conditions:[{field:'author',operator:'equals',value:'Author name'}],actions:[{type:'highlight',color:'#f59e0b'}]})}} className="text-xs text-soft">Highlight author</button>
            <button type="button" onClick={()=>{newRule({...blankDraft(),name:'Feature a folder',scope:{folderIds:navigation.folders[0]?[navigation.folders[0].id]:[]},conditions:[],actions:[{type:'feature_in_brew'}]})}} className="text-xs text-soft">Feature folder</button>
          </div>
        </div>
        <div className="mt-5 space-y-2">
          {rules.length === 0 && (
            <p className="rounded-xl border border-dashed border-line-strong p-5 text-sm text-soft">
              No rules yet.
            </p>
          )}
          {rules.map((rule) => (
            <article
              key={rule.id}
              aria-label={rule.name}
              data-brew-id={rule.id}
              data-brew-kind="rule"
              data-brew-state={rule.enabled ? 'enabled' : 'disabled'}
              className={`rounded-xl border p-3 ${selectedId === rule.id ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
            >
              <a data-brew-action="edit-rule" aria-label={rule.name} href={rulePageHref(rule.id)} onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); selectRule(rule); }} className="block w-full text-left">
                <span className="flex items-center justify-between gap-2">
                  <strong className="truncate text-sm">{rule.name}</strong>
                  <span
                    className={`h-2 w-2 rounded-full ${rule.enabled ? 'bg-positive' : 'bg-line-strong'}`}
                  />
                </span>
                <span className="mt-1 block text-xs text-soft">
                  {rule.conditions.length} condition{rule.conditions.length === 1 ? '' : 's'} ·{' '}
                  {rule.actions.length} action{rule.actions.length === 1 ? '' : 's'}
                </span>
                <span className="mt-1 block text-[11px] text-muted">
                  {rule.hits24h ?? 0} hits / 24 h · {rule.hits30d ?? 0} / 30 d
                </span>
              </a>
              <div className="mt-2 flex gap-2">
                <button data-brew-action="copy-rule" onClick={() => duplicate(rule)} className="text-xs text-soft">
                  Copy
                </button>
                <button data-brew-action="delete-rule" disabled={!owner.capable || owner.busy} onClick={() => remove(rule)} className="text-xs text-danger">
                  Delete
                </button>
                <a data-brew-action="rule-log" href={rulePageHref(rule.id, 'log')} onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); void showLogs(rule); }} className="text-xs text-soft">
                  Logs
                </a>
                <button data-brew-action="apply-rule" disabled={!owner.capable || owner.busy} onClick={() => applyExisting(rule)} className="text-xs text-accent">
                  Apply 30d
                </button>
              </div>
            </article>
          ))}
        </div>
      </aside>
      <form onSubmit={save} className="rounded-3xl border border-line bg-surface p-7 shadow-raised">
        <div className="flex items-center gap-3">
          <input
            aria-label="Rule name"
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            className="min-w-0 flex-1 border-0 bg-transparent text-2xl font-semibold outline-none"
          />
          <label className="flex items-center gap-2 text-xs text-soft">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) =>
                setDraft((current) => ({ ...current, enabled: event.target.checked }))
              }
            />{' '}
            Enabled
          </label>
        </div>
        <div className="mt-8 text-[17px] leading-[2.7] text-soft">
          When an article in{' '}
          <select
            aria-label="Rule scope"
            value={scopeMode}
            onChange={(event) => {
              const value = event.target.value;
              if (value === 'all') setDraft((current) => ({ ...current, scope: {} }));
              if (value === 'feed')
                setDraft((current) => ({
                  ...current,
                  scope: { feedIds: allFeeds[0] ? [allFeeds[0].id] : [] },
                }));
              if (value === 'folder')
                setDraft((current) => ({
                  ...current,
                  scope: { folderIds: navigation.folders[0] ? [navigation.folders[0].id] : [] },
                }));
            }}
            className={inputClass}
          >
            <option value="all">all feeds</option>
            <option value="feed">a feed</option>
            <option value="folder">a folder</option>
          </select>
          {scopeMode === 'feed' && (
            <select
              aria-label="Scope feed"
              value={draft.scope.feedIds?.[0] ?? ''}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  scope: { feedIds: [Number(event.target.value)] },
                }))
              }
              className={`ml-2 ${inputClass}`}
            >
              {allFeeds.map((feed) => (
                <option key={feed.id} value={feed.id}>
                  {feed.title}
                </option>
              ))}
            </select>
          )}
          {scopeMode === 'folder' && (
            <select
              aria-label="Scope folder"
              value={draft.scope.folderIds?.[0] ?? ''}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  scope: { folderIds: [Number(event.target.value)] },
                }))
              }
              className={`ml-2 ${inputClass}`}
            >
              {navigation.folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.title}
                </option>
              ))}
            </select>
          )}{' '}
          matches{' '}
          <select
            aria-label="Match type"
            value={draft.matchType}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                matchType: event.target.value as 'all' | 'any',
              }))
            }
            className={inputClass}
          >
            <option value="all">all</option>
            <option value="any">any</option>
          </select>{' '}
          of:
        </div>
        <div className="mt-3 space-y-3">
          {draft.conditions.map((condition, index) => (
            <div
              key={index}
              className="flex flex-wrap items-center gap-2 rounded-xl bg-canvas p-3"
            >
              <select
                aria-label={`Condition ${index + 1} field`}
                value={condition.field}
                onChange={(event) =>
                  setCondition(index, { field: event.target.value as RuleField })
                }
                className={inputClass}
              >
                {fields.map((field) => (
                  <option key={field}>{field}</option>
                ))}
              </select>
              <select
                aria-label={`Condition ${index + 1} operator`}
                value={condition.operator}
                onChange={(event) =>
                  setCondition(index, { operator: event.target.value as RuleOperator })
                }
                className={inputClass}
              >
                {operators.map((operator) => (
                  <option key={operator} value={operator}>
                    {operator.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Condition ${index + 1} value`}
                value={condition.value}
                onChange={(event) => setCondition(index, { value: event.target.value })}
                placeholder="value"
                className={`min-w-48 flex-1 ${inputClass}`}
              />
              <button
                type="button"
                aria-label={`Remove condition ${index + 1}`}
                disabled={draft.conditions.length === 1}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    conditions: current.conditions.filter((_, item) => item !== index),
                  }))
                }
                className="px-2 text-muted disabled:opacity-30"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={draft.conditions.length >= 10}
            onClick={() =>
              setDraft((current) => ({
                ...current,
                conditions: [
                  ...current.conditions,
                  { field: 'title', operator: 'contains', value: '' },
                ],
              }))
            }
            className="text-xs font-semibold text-accent"
          >
            + Add condition
          </button>
        </div>
        <div className="mt-8 text-[17px] text-soft">Then:</div>
        <div className="mt-3 space-y-3">
          {draft.actions.map((action, index) => (
            <div
              key={index}
              className="flex flex-wrap items-center gap-2 rounded-xl bg-canvas p-3"
            >
              <select
                aria-label={`Action ${index + 1}`}
                value={action.type}
                onChange={(event) =>
                  setAction(index, defaultAction(event.target.value as RuleAction['type']))
                }
                className={inputClass}
              >
                {actionTypes.map((type) => (
                  <option key={type} value={type}>
                    {actionLabels[type]}
                  </option>
                ))}
              </select>
              <ActionValue action={action} onChange={(next) => setAction(index, next)} />
              <button
                type="button"
                aria-label={`Remove action ${index + 1}`}
                disabled={draft.actions.length === 1}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    actions: current.actions.filter((_, item) => item !== index),
                  }))
                }
                className="px-2 text-muted disabled:opacity-30"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                actions: [...current.actions, { type: 'star' }],
              }))
            }
            className="text-xs font-semibold text-accent"
          >
            + Add action
          </button>
        </div>
        <label className="mt-7 flex items-center gap-2 text-sm text-soft">
          <input
            type="checkbox"
            checked={draft.stopProcessing}
            onChange={(event) =>
              setDraft((current) => ({ ...current, stopProcessing: event.target.checked }))
            }
          />{' '}
          Stop processing later rules when this matches
        </label>
        {(message || previewError) && (
          <p role="status" className="mt-4 text-sm text-soft">
            {message || previewError}
          </p>
        )}
        <button className="mt-7 rounded-full bg-inverse px-5 py-2.5 text-sm font-semibold text-on-inverse">
          Save rule
        </button>
      </form>
      <aside className="rounded-3xl border border-line bg-surface p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-soft">
          Live preview
        </p>
        <h2 className="mt-1 text-lg font-semibold">Would match {preview.length}</h2>
        <p className="mt-1 text-xs text-soft">
          Most recent matching articles, without running actions.
        </p>
        <div className="mt-4 space-y-2">
          {preview.slice(0, 50).map((article) => (
            <article key={article.id} className="border-b border-line pb-2">
              <h3 className="text-sm font-medium leading-snug">{article.title}</h3>
              <p className="mt-1 text-xs text-soft">{article.feedTitle}</p>
            </article>
          ))}
          {preview.length === 0 && (
            <p className="py-8 text-center text-sm text-muted">No matches yet.</p>
          )}
        </div>
        {(logs.length > 0 || tab === 'log') && (
          <section className="mt-7 border-t border-line pt-5" aria-label="Rule execution log">
            <h2 className="text-sm font-semibold">Recent executions</h2>
            {logs.length === 0 && <p className="mt-3 text-xs text-soft">No executions yet.</p>}
            <div className="mt-3 max-h-72 space-y-3 overflow-auto">
              {logs.map((log) => (
                <article key={log.id} className="text-xs">
                  <p className="font-medium">{log.articleTitle}</p>
                  <p className="text-muted">{new Date(log.executedAt).toLocaleString()}</p>
                  <p className="text-soft">{log.actions.map((action) => `${action.type}: ${action.ok ? 'ok' : action.error}`).join(', ')}</p>
                </article>
              ))}
            </div>
          </section>
        )}
      </aside>
      <OwnerActionUi action={owner} />
    </div>
  );
}

function defaultAction(type: RuleAction['type']): RuleAction {
  if (type === 'add_tag' || type === 'remove_tag') return { type, tag: '' };
  if (type === 'highlight') return { type, color: '#f59e0b' };
  if (type === 'webhook') return { type, url: 'https://' };
  return { type };
}
function ActionValue({
  action,
  onChange,
}: {
  action: RuleAction;
  onChange: (action: RuleAction) => void;
}) {
  if (action.type === 'add_tag' || action.type === 'remove_tag')
    return (
      <input
        aria-label="Tag name"
        value={action.tag}
        onChange={(event) => onChange({ ...action, tag: event.target.value })}
        placeholder="tag name"
        className={inputClass}
      />
    );
  if (action.type === 'highlight')
    return (
      <input
        aria-label="Highlight color"
        type="color"
        value={action.color}
        onChange={(event) => onChange({ ...action, color: event.target.value })}
        className="h-10 w-12 rounded border border-line-strong"
      />
    );
  if (action.type === 'webhook')
    return (
      <input
        aria-label="Webhook URL"
        type="url"
        value={action.url}
        onChange={(event) => onChange({ ...action, url: event.target.value })}
        className={`min-w-64 flex-1 ${inputClass}`}
      />
    );
  return null;
}
