import { useWebMcpSurface } from './webmcp/useWebMcpSurface';
import { Checkbox, Button, IconButton } from './components/controls';
import { agentPageHref } from './agentLocation';
import { type FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ruleCopySource } from '@brew/core/rule-copy';
import type { ActionKind } from '@brew/core/actions';
import { ModalSheet } from './components/Sheet';
import { Badge } from './components/Badge';
import { RuleHistory } from './rules/RuleHistory';
import { RulesSettings } from './rules/RulesSettings';
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
  RuleOperator,
  RulePreviewItem,
  RuleRecord,
} from '@brew/core/types/rules';

const ruleKinds: readonly ActionKind[] = ['copy_rule', 'delete_rule', 'apply_rule'];
const rulesKey = ['saved-rules'];
const emptyNavigation: ReaderNavigation = {
  counts: { all: 0, today: 0, starred: 0 },
  folders: [],
  unfiled: [],
};
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
  name: rule.name,
  enabled: rule.enabled,
  matchType: rule.matchType,
  scope: structuredClone(rule.scope),
  conditions: structuredClone(rule.conditions),
  actions: structuredClone(rule.actions),
  stopProcessing: rule.stopProcessing,
  position: rule.position,
});
function writeRuleLocation(id: number | null, tab: 'preview' | 'log') {
  const href = agentPageHref(rulePageHref(id, tab));
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
  const client = useQueryClient();
  const ruleList = useQuery({
    queryKey: rulesKey,
    queryFn: ({ signal }) => json<RuleRecord[]>('/api/rules', { signal }),
    retry: false,
  });
  const navigationQuery = useQuery({
    queryKey: ['rules-navigation'],
    queryFn: ({ signal }) => json<ReaderNavigation>('/api/reader/navigation', { signal }),
    retry: false,
  });
  const rules = ruleList.data ?? [];
  const navigation = navigationQuery.data ?? emptyNavigation;
  const [selectedId, setSelectedId] = useState<number | null>(
    () => rulePageLocation(new URL(location.href)).id,
  );
  const [tab, setTab] = useState(() => rulePageLocation(new URL(location.href)).tab);
  const [logPage, setLogPage] = useState(() => rulePageLocation(new URL(location.href)).page ?? 1);
  usePageAlternates(
    rulePageHref(selectedId, selectedId === null ? 'preview' : tab, logPage),
    'Saved rules',
  );
  const [newDraft] = useState(blankDraft);
  const [draftState, updateDraft] = useState<RuleDraft | null>(null);
  const selectedRule = rules.find((rule) => rule.id === selectedId);
  const loadedDraft = useMemo(
    () => (selectedRule ? savedDraft(selectedRule) : newDraft),
    [selectedRule, newDraft],
  );
  const draft = draftState ?? loadedDraft;
  const ruleForm = useRef<HTMLFormElement>(null);
  useWebMcpSurface(ruleForm, { names: ['create_rule'], fixed: { draft: { name: draft.name, enabled: draft.enabled, matchType: draft.matchType, scope: draft.scope, conditions: draft.conditions, actions: draft.actions, stopProcessing: draft.stopProcessing } } }, selectedId === null && !ruleList.isPending && !ruleList.isError);
  const setDraft = (next: RuleDraft | ((current: RuleDraft) => RuleDraft)) =>
    updateDraft((current) => (typeof next === 'function' ? next(current ?? loadedDraft) : next));
  const [message, setMessage] = useState('');
  const editorMessage =
    message ||
    (!ruleList.isPending && !ruleList.isError && selectedId !== null && !selectedRule
      ? 'Rule not found. Choose New or another saved rule.'
      : '');
  const [moreId, setMoreId] = useState<number | null>(null);
  const more = rules.find((rule) => rule.id === moreId);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const saveLock = useRef(false);
  const copyLock = useRef(false);
  const alive = useRef(true);
  const editorEpoch = useRef(0);
  const actionReturn = useRef<HTMLElement>(null);
  const editor = useRef({ draft, selectedId, href: location.pathname + location.search, epoch: 0 });
  useLayoutEffect(() => {
    editor.current = {
      draft,
      selectedId,
      href: location.pathname + location.search,
      epoch: editorEpoch.current,
    };
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const restore = () => {
      editorEpoch.current++;
      const route = rulePageLocation(new URL(location.href));
      setSelectedId(route.id);
      setTab(route.tab);
      setLogPage(route.page ?? 1);
      setMoreId(null);
      const selected = ruleList.data?.find((rule) => rule.id === route.id);
      if (editor.current.selectedId !== route.id)
        updateDraft(selected ? savedDraft(selected) : blankDraft());
      setMessage(route.id !== null && ruleList.data && !selected ? 'Rule not found.' : '');
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [ruleList.data]);
  const [previewInput, setPreviewInput] = useState(() => ({
    scope: draft.scope,
    matchType: draft.matchType,
    conditions: draft.conditions,
  }));
  const previewBody = useMemo(
    () => ({ scope: draft.scope, matchType: draft.matchType, conditions: draft.conditions }),
    [draft.scope, draft.matchType, draft.conditions],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => setPreviewInput(previewBody), 250);
    return () => window.clearTimeout(timer);
  }, [previewBody]);
  const previewQuery = useQuery({
    queryKey: ['rule-preview', 'counted', previewInput],
    queryFn: ({ signal }) =>
      json<{ items: RulePreviewItem[]; total: number }>('/api/rules/preview?includeTotal=true', {
        method: 'POST',
        signal,
        body: JSON.stringify(previewInput),
      }).then((result) => {
        if (!Number.isSafeInteger(result.total) || result.total < result.items.length)
          throw new Error('Could not read the matching-article total. Retry preview.');
        return result;
      }),
    retry: false,
  });
  const previewPending =
    previewBody !== previewInput || previewQuery.isFetching || previewQuery.isPending;
  const preview = previewQuery.data?.items ?? [];
  const owner = useOwnerActions(async (receipt) => {
    const before = client
      .getQueryData<RuleRecord[]>(rulesKey)
      ?.find((rule) => rule.id === receipt.targetId);
    if (!alive.current) return;
    if (
      ((receipt.kind === 'delete_rule' && !receipt.undoneAt) ||
        (receipt.kind === 'copy_rule' && receipt.undoneAt)) &&
      editor.current.selectedId === receipt.targetId
    ) {
      setSelectedId(null);
      setTab('preview');
      writeRuleLocation(null, 'preview');
      if (!before || JSON.stringify(editor.current.draft) === JSON.stringify(savedDraft(before)))
        setDraft(blankDraft());
      else setMessage('The saved rule was removed. Your unsaved draft is kept.');
    }
    await ruleList.refetch({ throwOnError: true });
    if (receipt.kind === 'apply_rule')
      await client.invalidateQueries({ queryKey: ['rule-logs', receipt.targetId] });
  }, ruleKinds);
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
    editorEpoch.current++;
    setLogPage(1);
    setSelectedId(rule.id);
    setDraft(savedDraft(rule));
    setTab(nextTab);
    writeRuleLocation(rule.id, nextTab);
    setMessage('');
  };
  const newRule = (next = blankDraft()) => {
    editorEpoch.current++;
    setLogPage(1);
    setSelectedId(null);
    setDraft(next);
    setTab('preview');
    setMessage('');
    writeRuleLocation(null, 'preview');
  };
  const sameEditor = (context: typeof editor.current) =>
    alive.current &&
    editorEpoch.current === context.epoch &&
    editor.current.draft === context.draft &&
    editor.current.selectedId === context.selectedId &&
    location.pathname + location.search === context.href;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    const context = editor.current;
    try {
      const saved = await json<RuleRecord>(
        context.selectedId === null ? '/api/rules' : `/api/rules/${context.selectedId}`,
        {
          method: context.selectedId === null ? 'POST' : 'PUT',
          body: JSON.stringify(context.draft),
        },
      );
      if (sameEditor(context)) {
        selectRule(saved);
        setMessage('Rule saved.');
      } else if (
        alive.current &&
        editorEpoch.current === context.epoch &&
        editor.current.selectedId === context.selectedId &&
        location.pathname + location.search === context.href
      ) {
        setSelectedId(saved.id);
        writeRuleLocation(saved.id, 'preview');
        setMessage('Rule saved. Your newer edits are not saved.');
      }
      await ruleList.refetch();
    } catch (error) {
      if (
        alive.current &&
        editorEpoch.current === context.epoch &&
        editor.current.selectedId === context.selectedId &&
        location.pathname + location.search === context.href
      )
        setMessage(
          `Save result was not confirmed. ${(error as Error).message} Refresh rules before creating another rule.`,
        );
    } finally {
      saveLock.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const rememberTrigger = (element?: HTMLElement) => {
    if (element) (actionReturn as { current: HTMLElement | null }).current = element;
  };
  const remove = (rule: RuleRecord, element?: HTMLElement) => {
    rememberTrigger(element);
    setMoreId(null);
    setMessage('');
    void owner.ask({ kind: 'delete_rule', id: rule.id }, rule.name);
  };
  const duplicate = async (rule: RuleRecord, element?: HTMLElement) => {
    if (copyLock.current || !owner.capable || owner.busy || owner.intent) return;
    rememberTrigger(element);
    setMoreId(null);
    copyLock.current = true;
    setCopying(true);
    const context = editor.current;
    try {
      const receipt = await owner.perform(
        { kind: 'copy_rule', id: rule.id, definition: ruleCopySource(rule) },
        rule.name,
      );
      if (receipt && sameEditor(context)) {
        const created = client
          .getQueryData<RuleRecord[]>(rulesKey)
          ?.find((item) => item.id === receipt.targetId);
        if (created) selectRule(created);
      }
    } catch (error) {
      if (sameEditor(context)) setMessage(`Could not copy rule. ${(error as Error).message}`);
    } finally {
      copyLock.current = false;
      if (alive.current) setCopying(false);
    }
  };
  const showLogs = (rule: RuleRecord) => {
    setMoreId(null);
    selectRule(rule, 'log');
  };
  const applyExisting = (rule: RuleRecord, element?: HTMLElement) => {
    rememberTrigger(element);
    setMoreId(null);
    setMessage('');
    owner.ask(
      { kind: 'apply_rule', id: rule.id, days: 30 },
      rule.name,
      rule.actions.some((action) => ['webhook', 'notify'].includes(action.type)),
    );
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

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-7 py-8 lg:grid-cols-[18rem_minmax(0,1fr)_20rem]">
      <aside aria-label="Saved rules">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-soft">Automations</p>
            <h1 tabIndex={-1} className="mt-1 text-2xl font-semibold">
              Rules
            </h1>
          </div>
          <button
            data-brew-action="new-rule"
            onClick={() => {
              newRule();
            }}
            className="rounded-full bg-inverse px-3 py-2 text-xs font-semibold text-on-inverse"
          >
            New
          </button>
        </div>
        <RulesSettings />
        <div className="mt-5 rounded-xl bg-subtle p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-soft">Templates</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              data-brew-action="rule-template"
              onClick={() => {
                newRule({
                  ...blankDraft(),
                  name: 'Mute a keyword',
                  conditions: [{ field: 'title', operator: 'contains', value: 'keyword' }],
                  actions: [{ type: 'hide' }],
                });
              }}
              className="brew-compact-control text-xs text-soft"
            >
              Mute keyword
            </button>
            <button
              type="button"
              data-brew-action="rule-template"
              onClick={() => {
                newRule({
                  ...blankDraft(),
                  name: 'Highlight an author',
                  conditions: [{ field: 'author', operator: 'equals', value: 'Author name' }],
                  actions: [{ type: 'highlight', color: '#f59e0b' }],
                });
              }}
              className="brew-compact-control text-xs text-soft"
            >
              Highlight author
            </button>
            <button
              type="button"
              data-brew-action="rule-template"
              onClick={() => {
                newRule({
                  ...blankDraft(),
                  name: 'Feature a folder',
                  scope: { folderIds: navigation.folders[0] ? [navigation.folders[0].id] : [] },
                  conditions: [],
                  actions: [{ type: 'feature_in_brew' }],
                });
              }}
              className="brew-compact-control text-xs text-soft"
            >
              Feature folder
            </button>
          </div>
        </div>
        <div className="mt-5 space-y-2">
          <button
            type="button"
            disabled={ruleList.isFetching}
            className="brew-compact-control text-xs text-soft"
            data-brew-action="refresh-rules"
            onClick={() => void ruleList.refetch()}
          >
            Refresh rules
          </button>
          {ruleList.isError && (
            <div role="alert" className="text-sm text-danger">
              Could not refresh rules.{' '}
              {ruleList.data
                ? 'Previously loaded rules are shown.'
                : 'Saved rules are unavailable.'}
              <button
                type="button"
                className="brew-compact-control block text-accent"
                onClick={() => void ruleList.refetch()}
              >
                Retry rules
              </button>
            </div>
          )}
          {navigationQuery.isError && (
            <div role="alert" className="text-sm text-danger">
              Could not load feed and folder choices.
              <button
                type="button"
                className="brew-compact-control block text-accent"
                onClick={() => void navigationQuery.refetch()}
              >
                Retry scope choices
              </button>
            </div>
          )}
          {ruleList.data && (
            <p
              role="status"
              aria-label="Saved rule total"
              aria-live="polite"
              aria-atomic="true"
              className="text-xs text-soft"
            >
              {rules.length} saved {rules.length === 1 ? 'rule' : 'rules'}
              {(ruleList.isError || ruleList.isFetching) && ' · Last loaded'}
            </p>
          )}
          {ruleList.isPending && (
            <p role="status" aria-label="Rules loading">
              Loading rules…
            </p>
          )}
          {!ruleList.isPending && !ruleList.isError && rules.length === 0 && (
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
              <a
                data-brew-action="edit-rule"
                aria-label={rule.name}
                href={agentPageHref(rulePageHref(rule.id))}
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
                  selectRule(rule);
                }}
                className="block w-full text-left"
              >
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
                <button
                  data-brew-action="copy-rule"
                  disabled={!owner.capable || owner.busy || copying || Boolean(owner.intent)}
                  onClick={(event) => void duplicate(rule, event.currentTarget)}
                  className="brew-compact-control text-xs text-soft"
                >
                  Copy
                </button>
                <button
                  data-brew-action="delete-rule"
                  disabled={!owner.capable || owner.busy || copying || Boolean(owner.intent)}
                  onClick={(event) => remove(rule, event.currentTarget)}
                  className="brew-compact-control text-xs text-danger"
                >
                  Delete
                </button>
                <a
                  data-brew-action="rule-log"
                  href={agentPageHref(rulePageHref(rule.id, 'log'))}
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
                    void showLogs(rule);
                  }}
                  className="brew-compact-control text-xs text-soft"
                >
                  Logs
                </a>
                <button
                  data-brew-action="apply-rule"
                  disabled={!owner.capable || owner.busy || copying || Boolean(owner.intent)}
                  onClick={(event) => applyExisting(rule, event.currentTarget)}
                  className="brew-compact-control text-xs text-accent"
                >
                  Apply 30d
                </button>
                <IconButton
                  icon="more"
                  label={`More actions for rule ${rule.name}`}
                  data-brew-action="rule-more"
                  onClick={(event) => {
                    rememberTrigger(event.currentTarget);
                    setMoreId(rule.id);
                  }}
                />
              </div>
            </article>
          ))}
        </div>
      </aside>
      <form
        ref={ruleForm}
        aria-label="Rule editor"
        onSubmit={save}
        className="min-w-0 rounded-3xl border border-line bg-surface p-7 shadow-raised"
      >
        <fieldset
          className="contents"
          disabled={
            ruleList.isPending || (draftState === null && selectedId !== null && !selectedRule)
          }
        >
          <div className="flex items-center gap-3">
            <input
              aria-label="Rule name"
              data-brew-action="set-rule-name"
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              className="min-w-0 flex-1 border-0 bg-transparent text-2xl font-semibold outline-none"
            />
            <Checkbox
              label="Enabled"
              data-brew-action="set-rule-enabled"
              checked={draft.enabled}
              onChange={(event) =>
                setDraft((current) => ({ ...current, enabled: event.target.checked }))
              }
            />
          </div>
          <div className="mt-8 text-[17px] leading-[2.7] text-soft">
            When an article in{' '}
            <select
              aria-label="Rule scope"
              data-brew-action="set-rule-scope"
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
              <option value="feed" disabled={!allFeeds.length}>
                a feed
              </option>
              <option value="folder" disabled={!navigation.folders.length}>
                a folder
              </option>
            </select>
            {scopeMode === 'feed' && (
              <select
                aria-label="Scope feed"
                data-brew-action="set-rule-scope-feed"
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
                data-brew-action="set-rule-scope-folder"
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
                  data-brew-action="set-rule-condition-field"
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
                  data-brew-action="set-rule-condition-operator"
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
                  data-brew-action="set-rule-condition-value"
                  value={condition.value}
                  onChange={(event) => setCondition(index, { value: event.target.value })}
                  placeholder="value"
                  className={`min-w-48 flex-1 ${inputClass}`}
                />
                <button
                  type="button"
                  aria-label={`Remove condition ${index + 1}`}
                  data-brew-action="remove-rule-condition"
                  disabled={draft.conditions.length === 1}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      conditions: current.conditions.filter((_, item) => item !== index),
                    }))
                  }
                  className="brew-compact-control px-2 text-muted disabled:opacity-30"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              data-brew-action="add-rule-condition"
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
              className="brew-compact-control text-xs font-semibold text-accent"
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
                  data-brew-action="set-rule-action"
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
                  data-brew-action="remove-rule-action"
                  disabled={draft.actions.length === 1}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      actions: current.actions.filter((_, item) => item !== index),
                    }))
                  }
                  className="brew-compact-control px-2 text-muted disabled:opacity-30"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              data-brew-action="add-rule-action"
              type="button"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  actions: [...current.actions, { type: 'star' }],
                }))
              }
              className="brew-compact-control text-xs font-semibold text-accent"
            >
              + Add action
            </button>
          </div>
          <Checkbox
            className="mt-7"
            label="Stop processing later rules when this matches"
            data-brew-action="set-rule-stop-processing"
            checked={draft.stopProcessing}
            onChange={(event) =>
              setDraft((current) => ({ ...current, stopProcessing: event.target.checked }))
            }
          />
          {editorMessage && (
            <p role="status" aria-label="Rule editor result" className="mt-4 text-sm text-soft">
              {editorMessage}
            </p>
          )}
          <button
            disabled={saving}
            data-brew-action="save-rule"
            className="mt-7 rounded-full bg-inverse px-5 py-2.5 text-sm font-semibold text-on-inverse"
          >
            {saving ? 'Saving rule…' : 'Save rule'}
          </button>
        </fieldset>
      </form>
      <aside aria-label="Rule preview" className="rounded-3xl border border-line bg-surface p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-soft">Live preview</p>
        <h2 className="mt-1 text-lg font-semibold">
          {previewPending
            ? 'Updating preview…'
            : previewQuery.isError
              ? 'Preview unavailable'
              : `Would match ${previewQuery.data?.total ?? preview.length}`}
        </h2>
        <p className="mt-1 text-xs text-soft">
          Up to 50 recent matching articles, without running actions.
        </p>
        {!previewPending && !previewQuery.isError && previewQuery.data && (
          <p role="status" aria-label="Preview range" className="mt-2 text-xs text-soft">
            Showing {preview.length ? 1 : 0}–{preview.length} of {previewQuery.data.total} matching
            articles
          </p>
        )}
        <div className="mt-4 space-y-2">
          {!previewPending &&
            !previewQuery.isError &&
            preview.slice(0, 50).map((article) => (
              <article
                key={article.id}
                data-brew-id={article.id}
                data-brew-kind="article"
                data-brew-state="preview"
                className="border-b border-line pb-2"
              >
                <h3 className="text-sm font-medium leading-snug">{article.title}</h3>
                <p className="mt-1 text-xs text-soft">{article.feedTitle}</p>
              </article>
            ))}
          {previewQuery.isError && !previewPending && (
            <div role="alert" className="text-sm text-danger">
              {previewQuery.error.message}
              <button
                type="button"
                className="brew-compact-control block text-accent"
                onClick={() => void previewQuery.refetch()}
              >
                Retry preview
              </button>
            </div>
          )}
          {!previewPending && !previewQuery.isError && preview.length === 0 && (
            <p className="py-8 text-center text-sm text-muted">No matches yet.</p>
          )}
        </div>
        {selectedId !== null && tab === 'log' && (
          <RuleHistory
            id={selectedId}
            page={logPage}
            onPage={(page, href) => {
              setLogPage(page);
              if (location.pathname + location.search !== href) history.pushState(null, '', href);
            }}
          />
        )}
      </aside>
      <ModalSheet
        open={Boolean(more)}
        title="Rule actions"
        description={more?.name}
        returnFocusRef={actionReturn}
        onClose={() => setMoreId(null)}
      >
        {more && (
          <div className="flex flex-col items-start gap-3">
            <a
              className="brew-compact-control text-sm text-accent"
              href={agentPageHref(rulePageHref(more.id))}
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
                setMoreId(null);
                selectRule(more);
              }}
            >
              Edit rule
            </a>
            <a
              className="brew-compact-control text-sm text-accent"
              href={agentPageHref(rulePageHref(more.id, 'log'))}
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
                showLogs(more);
              }}
            >
              Execution logs
            </a>
            <Button
              disabled={!owner.capable || owner.busy || copying || Boolean(owner.intent)}
              onClick={() => void duplicate(more)}
            >
              Copy
            </Button>
            <Button
              variant="secondary"
              disabled={!owner.capable || owner.busy || copying || Boolean(owner.intent)}
              onClick={() => applyExisting(more)}
            >
              Apply 30d
            </Button>
            <Button
              variant="secondary"
              disabled={!owner.capable || owner.busy || copying || Boolean(owner.intent)}
              onClick={() => remove(more)}
            >
              Delete
            </Button>
            {!owner.capable && (
              <p className="text-sm text-soft">
                <Badge tone="warning">Rule actions need setup</Badge>{' '}
                <a
                  className="brew-compact-control text-accent"
                  href={agentPageHref('/settings/runs#setup-agents')}
                >
                  Set up agent access
                </a>
              </p>
            )}
          </div>
        )}
      </ModalSheet>
      <OwnerActionUi action={owner} returnFocusRef={actionReturn} />
      {copying && (
        <p role="status" aria-label="Rule copy progress" className="text-sm text-soft">
          {owner.intent?.submitted
            ? 'Copy result is unconfirmed. Check result to recover the same request.'
            : 'Copying saved rule…'}
        </p>
      )}
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
        data-brew-action="set-rule-tag"
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
        data-brew-action="set-rule-highlight"
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
        data-brew-action="set-rule-webhook"
        type="url"
        value={action.url}
        onChange={(event) => onChange({ ...action, url: event.target.value })}
        className={`min-w-64 flex-1 ${inputClass}`}
      />
    );
  return null;
}
