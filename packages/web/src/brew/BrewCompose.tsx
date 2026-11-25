import { useCallback, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  BrewConfig,
  BrewConfigDraft,
  BrewSection,
  BrewSourceRef,
  BrewPreview,
} from '@brew/core/types/brew';
import type { ReaderNavigation, TagSummary } from '@brew/core/types/api';
import { newBrewSection, sectionWithSources } from '@brew/core/composition-model';
import { Button, Chip, IconButton, Input, SegmentedControl, Toggle } from '../components/controls';
import { SectionCard, SentenceToken, Stepper, Select, TopBar } from '../components/patterns';
import { ModalSheet } from '../components/Sheet';
import { Icon } from '../components/Icon';
import { Badge } from '../components/Badge';
import { useCapabilities } from '../hooks/useCapabilities';
import { ComposePreview } from './ComposePreview';
import { composeJson, useComposeDraft } from './useComposeDraft';
import { SourcePicker, ScheduleEditor } from './CompositionSheets';

function newsletterSourceName(source: BrewSourceRef): string {
  const choices = [
    source.senderIds?.length
      ? `${source.senderIds.length} sender${source.senderIds.length === 1 ? '' : 's'}`
      : '',
    source.tagIds?.length
      ? `${source.tagIds.length} tag${source.tagIds.length === 1 ? '' : 's'}`
      : '',
  ].filter(Boolean);
  return choices.length ? `Newsletters · ${choices.join(' · ')}` : 'All senders';
}

type Props = {
  id: number;
  brews: readonly { id: string; name: string }[];
  onBrewChange: (id: number) => void;
  onRead: () => void;
  onGenerate: () => Promise<void>;
};
export function BrewCompose(props: Props) {
  const query = useQuery({
    queryKey: ['composition', props.id],
    queryFn: ({ signal }) =>
      composeJson<BrewConfig>(`/api/brew-configs/${props.id}/composition`, { signal }),
  });
  if (query.isError)
    return (
      <main className="compose-load-error">
        <h1>Could not load Compose.</h1>
        <p>{query.error.message}</p>
        <Button onClick={() => void query.refetch()}>Retry</Button>
        <Button variant="secondary" onClick={props.onRead}>
          Back to Read
        </Button>
      </main>
    );
  if (!query.data)
    return (
      <main role="status" className="brew-read-loading">
        Loading Compose…
      </main>
    );
  return <ComposeEditor {...props} initial={query.data} />;
}
function ComposeEditor({ initial, ...props }: Props & { initial: BrewConfig }) {
  const { draft, update, flush, applySettings, status, failed } = useComposeDraft(initial);
  const [expanded, setExpanded] = useState<string | null>(
    () => new URLSearchParams(location.search).get('section') ?? initial.sections[0]?.id ?? null,
  );
  const [sheet, setSheet] = useState<string | null>(() =>
    new URLSearchParams(location.search).get('sheet'),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removed, setRemoved] = useState<{ section: BrewSection; index: number } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const drag = useRef<string | null>(null);
  const titles = useRef(new Map<string, HTMLInputElement>());
  const [matches, setMatches] = useState<{ draft: BrewConfigDraft; preview: BrewPreview } | null>(
    null,
  );
  const onPreview = useCallback(
    (preview: BrewPreview, value: BrewConfigDraft) => setMatches({ draft: value, preview }),
    [],
  );
  const nav = useQuery({
    queryKey: ['reader-navigation'],
    queryFn: () => composeJson<ReaderNavigation>('/api/reader/navigation'),
  });
  const tags = useQuery({
    queryKey: ['tags'],
    queryFn: () => composeJson<TagSummary[]>('/api/tags'),
  });
  const capabilities = useCapabilities();
  const searches = useQuery({
    queryKey: ['source-searches'],
    queryFn: () =>
      composeJson<import('@brew/core/types/sources').SavedSourceSearch[]>('/api/sources/searches'),
  });
  const active = draft.sections.find((section) => section.id === expanded);
  const url = (section: string | null, nextSheet: string | null) => {
    const value = new URL(location.href);
    if (section) value.searchParams.set('section', section);
    else value.searchParams.delete('section');
    if (nextSheet) value.searchParams.set('sheet', nextSheet);
    else value.searchParams.delete('sheet');
    window.history.replaceState({}, '', value);
  };
  const expand = (id: string | null, focus = false) => {
    setExpanded(id);
    url(id, null);
    if (focus && id) requestAnimationFrame(() => titles.current.get(id)?.focus());
  };
  const showSheet = (value: string | null) => {
    setSheet(value);
    url(expanded, value);
  };
  const sectionUpdate = (id: string, partial: Partial<BrewSection>) =>
    update((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === id ? { ...section, ...partial } : section,
      ),
    }));
  const sourceName = (source: BrewSourceRef) =>
    source.kind === 'folder'
      ? (nav.data?.folders.find((folder) => folder.id === source.id)?.title ??
        `Folder ${source.id}`)
      : source.kind === 'feed'
        ? ([
            ...(nav.data?.folders.flatMap((folder) => folder.feeds) ?? []),
            ...(nav.data?.unfiled ?? []),
          ].find((feed) => feed.id === source.id)?.title ?? `Feed ${source.id}`)
        : source.kind === 'tag'
          ? (tags.data?.find((tag) => tag.id === source.id)?.name ?? `Tag ${source.id}`)
          : {
              today: 'Today',
              starred: 'Starred',
              featured: 'Featured by rules',
              weekly_review: 'Weekly review',
              newsletters: newsletterSourceName(source),
              saved_search:
                searches.data?.find((search) => search.id === source.id)?.name ?? 'Saved search',
            }[source.kind];
  const move = (id: string, direction: number) => {
    const focused = document.activeElement as HTMLElement | null;
    update((current) => {
      const sections = [...current.sections];
      const index = sections.findIndex((section) => section.id === id);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= sections.length) return current;
      const [section] = sections.splice(index, 1);
      sections.splice(next, 0, section!);
      return { ...current, sections };
    });
    requestAnimationFrame(() => {
      if (
        document.activeElement === document.body &&
        focused?.isConnected &&
        !focused.matches(':disabled')
      )
        focused.focus();
    });
  };
  const drop = (id: string) => {
    if (!drag.current || drag.current === id) return;
    const from = draft.sections.findIndex((section) => section.id === drag.current);
    const to = draft.sections.findIndex((section) => section.id === id);
    if (from >= 0 && to >= 0) move(drag.current, to - from);
    drag.current = null;
  };
  const leave = async (action: () => void) => {
    if (await flush()) action();
  };
  const make = async () => {
    setBusy(true);
    setError('');
    try {
      if (await flush(true)) await props.onGenerate();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const add = (kind: BrewSection['kind']) => {
    const section = newBrewSection(crypto.randomUUID(), kind);
    update((current) => ({ ...current, sections: [...current.sections, section] }));
    setRemoved(null);
    showSheet(null);
    expand(section.id, true);
  };
  const remove = () => {
    if (!active) return;
    setRemoved({
      section: active,
      index: draft.sections.findIndex((section) => section.id === active.id),
    });
    update((current) => ({
      ...current,
      sections: current.sections.filter((section) => section.id !== active.id),
    }));
    setConfirmRemove(false);
    showSheet(null);
    expand(null);
  };
  const summary =
    draft.schedule.kind === 'weekdays'
      ? 'Weekdays'
      : draft.schedule.kind === 'weekly'
        ? 'Weekly'
        : draft.schedule.kind === 'monthly'
          ? 'Monthly'
          : 'Daily';
  return (
    <div className="compose-workspace">
      <TopBar
        brews={props.brews}
        brewId={String(props.id)}
        onBrewChange={(id) => void leave(() => props.onBrewChange(Number(id)))}
        view="compose"
        onViewChange={(value) => {
          if (value === 'read') void leave(props.onRead);
        }}
        date=""
        rightActions={
          <>
            <span role="status" aria-label="Autosave" className="compose-save-status">
              {status}
            </span>
            {failed && (
              <Button size="sm" variant="secondary" onClick={() => void flush()}>
                Retry save
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              icon={<Icon name="send" size={14} />}
              disabled={!capabilities.data?.emailDelivery}
              onClick={() => showSheet('schedule')}
              aria-describedby="compose-mail-state"
            >
              Send test
            </Button>
            <Button
              size="sm"
              icon={<Icon name="refresh" size={14} />}
              disabled={busy}
              onClick={() => void make()}
            >
              {busy ? 'Making this Brew…' : 'Make one now'}
            </Button>
          </>
        }
      />
      <div className="compose-split">
        <div className="compose-editor">
          <fieldset className="compose-controls" disabled={busy}>
            <section className="compose-schedule" aria-label="Schedule summary">
              <div>
                <Icon name="clock" size={16} />
                <strong>
                  {draft.enabled ? `${summary} at ${draft.schedule.time}` : 'Schedule paused'}
                </strong>
                <span className="brew-spacer" />
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Icon name="pencil" size={14} />}
                  onClick={() => showSheet('schedule')}
                >
                  Edit
                </Button>
              </div>
              <p>
                {draft.timezone}
                {draft.schedule.skipIfFewerThan
                  ? ` · skipped when fewer than ${draft.schedule.skipIfFewerThan} new items`
                  : ''}
              </p>
              <div className="compose-delivery">
                <span>Delivered to</span>
                <Chip icon={<Icon name="browser" size={14} />}>Web</Chip>
                {draft.delivery.feed && <Chip icon={<Icon name="rss" size={14} />}>Atom feed</Chip>}
                {draft.delivery.email && <Chip icon={<Icon name="mail" size={14} />}>Email</Chip>}
                <span id="compose-mail-state">
                  <Badge tone={capabilities.data?.emailDelivery ? 'neutral' : 'warning'}>
                    {capabilities.data?.emailDelivery ? 'Preview only' : 'Needs mail add-on'}
                  </Badge>
                </span>
                <a href="/settings/runs#setup-delivery">Set up</a>
              </div>
            </section>
            <div className="compose-sections-heading">
              <h1>Sections</h1>
              <span>{draft.sections.length}</span>
              <IconButton icon="more" label="Brew options" onClick={() => showSheet('brew')} />
              <span className="brew-spacer" />
              <Button
                size="sm"
                variant="secondary"
                icon={<Icon name="plus" size={14} />}
                onClick={() => showSheet('add-section')}
              >
                Add section
              </Button>
            </div>
            {draft.sections.map((section, index) => (
              <SectionCard
                key={section.id}
                sectionId={section.id}
                title={section.title}
                expanded={expanded === section.id}
                onExpandedChange={(open) => expand(open ? section.id : null)}
                onMoveUp={index ? () => move(section.id, -1) : undefined}
                onMoveDown={
                  index < draft.sections.length - 1 ? () => move(section.id, 1) : undefined
                }
                onDragStart={(event) => {
                  drag.current = section.id;
                  event.dataTransfer.setData('text/plain', section.id);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => drop(section.id)}
                titleEditor={
                  expanded === section.id ? (
                    <input
                      aria-label="Section title"
                      ref={(element) => {
                        if (element) titles.current.set(section.id, element);
                        else titles.current.delete(section.id);
                      }}
                      value={section.title}
                      onChange={(event) => sectionUpdate(section.id, { title: event.target.value })}
                      aria-invalid={!section.title.trim()}
                    />
                  ) : undefined
                }
                summary={
                  <>
                    {section.kind === 'items' ? (
                      <>
                        <Chip>{sourceName(section.sources[0] ?? { kind: 'today' })}</Chip>
                        <span>
                          {section.depth === 'brief' ? 'Brief, then ' : ''}
                          {section.layout === 'lead'
                            ? 'Lead'
                            : section.layout === 'headlines'
                              ? 'Headlines'
                              : section.layout === 'grid'
                                ? 'Grid'
                                : 'Magazine'}{' '}
                          · {section.maxItems}
                          {section.onlyUnread ? ' · unread only' : ''}
                        </span>
                      </>
                    ) : (
                      <>
                        <Chip icon={<Icon name="file" size={14} />}>Text</Chip>
                        <span>
                          {section.note ? `“${section.note.slice(0, 36)}”` : section.title}
                        </span>
                      </>
                    )}
                    {!!section.days?.length && (
                      <Badge tone="neutral">
                        {section.days.length === 1
                          ? [
                              'Sundays',
                              'Mondays',
                              'Tuesdays',
                              'Wednesdays',
                              'Thursdays',
                              'Fridays',
                              'Saturdays',
                            ][section.days[0]!]
                          : section.days
                              .map((day) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day])
                              .join(', ')}{' '}
                        only
                      </Badge>
                    )}
                  </>
                }
              >
                {section.kind === 'items' ? (
                  <>
                    <div className="brew-field">
                      <span className="brew-field-label">From</span>
                      <div className="compose-sources">
                        {section.sources.map((source) => (
                          <button
                            key={`${source.kind}:${source.id ?? ''}`}
                            type="button"
                            aria-label={`Edit source ${sourceName(source)}`}
                            onClick={() => showSheet('add-source')}
                          >
                            <Chip
                              icon={
                                <Icon
                                  name={
                                    source.kind === 'newsletters'
                                      ? 'inbox'
                                      : source.kind === 'starred'
                                        ? 'star'
                                        : 'folder'
                                  }
                                  size={14}
                                />
                              }
                            >
                              {sourceName(source)}
                            </Chip>
                          </button>
                        ))}
                        <button
                          type="button"
                          className="compose-link"
                          onClick={() => showSheet('add-source')}
                        >
                          + Source
                        </button>
                      </div>
                    </div>
                    <div className="brew-field">
                      <span className="brew-field-label">Layout</span>
                      <SegmentedControl
                        label="Section layout"
                        value={section.layout}
                        options={[
                          { value: 'lead', label: 'Lead' },
                          { value: 'magazine', label: 'Magazine' },
                          { value: 'grid', label: 'Grid' },
                          { value: 'headlines', label: 'Headlines' },
                        ]}
                        onValueChange={(layout) =>
                          sectionUpdate(section.id, { layout: layout as BrewSection['layout'] })
                        }
                      />
                    </div>
                    <div className="brew-field">
                      <span className="brew-field-label">Items</span>
                      <Stepper
                        label="Items at most"
                        value={section.maxItems}
                        onValueChange={(maxItems) => sectionUpdate(section.id, { maxItems })}
                      />
                      <span className="compose-caption">at most</span>
                    </div>
                    <div className="brew-field">
                      <span className="brew-field-label">Show</span>
                      <div>
                        <SegmentedControl
                          label="Section depth"
                          value={section.depth}
                          options={[
                            { value: 'title', label: 'Title' },
                            { value: 'excerpt', label: 'Excerpt' },
                            { value: 'full', label: 'Full text' },
                            {
                              value: 'brief',
                              label: 'Brief',
                              disabled: !capabilities.data?.ai.configured,
                            },
                          ]}
                          onValueChange={(depth) =>
                            sectionUpdate(section.id, { depth: depth as BrewSection['depth'] })
                          }
                        />
                        {!capabilities.data?.ai.configured && (
                          <p className="compose-gate">
                            <Badge tone="locked">Set up AI</Badge>
                            <a href="/settings/runs#setup-ai">Set up</a>
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="brew-field">
                      <span className="brew-field-label">Options</span>
                      <div className="compose-toggles">
                        <Toggle
                          label="Images"
                          checked={section.images}
                          onCheckedChange={(images) => sectionUpdate(section.id, { images })}
                        />
                        <Toggle
                          label="Unread only"
                          checked={section.onlyUnread}
                          onCheckedChange={(onlyUnread) =>
                            sectionUpdate(section.id, { onlyUnread })
                          }
                        />
                      </div>
                    </div>
                    <div className="brew-field">
                      <span className="brew-field-label">Order</span>
                      <Select
                        label="Section order"
                        hideLabel
                        value={section.sort}
                        onChange={(event) =>
                          sectionUpdate(section.id, {
                            sort: event.target.value as BrewSection['sort'],
                          })
                        }
                      >
                        <option value="newest">Newest first</option>
                        <option value="oldest">Oldest first</option>
                        <option value="longest">Longest read</option>
                      </Select>
                    </div>
                    <SectionFilter
                      section={section}
                      onChange={(filter) => sectionUpdate(section.id, { filter })}
                      matches={
                        matches?.draft === draft
                          ? matches.preview.snapshot.sections.find(
                              (value) => value.id === section.id,
                            )
                          : undefined
                      }
                      onOptions={() => showSheet('section-options')}
                    />
                  </>
                ) : (
                  <>
                    {section.kind === 'note' ? (
                      <label className="compose-note-label">
                        Note · Markdown
                        <textarea
                          value={section.note ?? ''}
                          onChange={(event) =>
                            sectionUpdate(section.id, { note: event.target.value })
                          }
                          placeholder="One section at a time."
                        />
                      </label>
                    ) : (
                      <p className="compose-caption">
                        A dividing line and the section title appear in your Brew.
                      </p>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => showSheet('section-options')}>
                      Section options
                    </Button>
                  </>
                )}
              </SectionCard>
            ))}
            {!draft.sections.length && <p>Add a section to start composing.</p>}
            {removed && (
              <div className="compose-removed" role="status">
                Removed {removed.section.title}.
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    update((current) => {
                      const sections = [...current.sections];
                      sections.splice(Math.min(removed.index, sections.length), 0, removed.section);
                      return { ...current, sections };
                    });
                    expand(removed.section.id);
                    setRemoved(null);
                  }}
                >
                  Undo
                </Button>
              </div>
            )}
            {error && <p role="alert">{error}</p>}
          </fieldset>
        </div>
        <ComposePreview
          draft={draft}
          id={props.id}
          expanded={expanded}
          onEdit={(id) => expand(id, true)}
          onPreview={onPreview}
        />
      </div>
      <ModalSheet
        open={sheet === 'add-section'}
        title="Add section"
        onClose={() => showSheet(null)}
      >
        <div className="compose-add-choices">
          <Button
            variant="secondary"
            onClick={() => add('items')}
            icon={<Icon name="layers" size={16} />}
          >
            Items
          </Button>
          <Button
            variant="secondary"
            onClick={() => add('note')}
            icon={<Icon name="file" size={16} />}
          >
            Note
          </Button>
          <Button variant="secondary" onClick={() => add('divider')}>
            Divider
          </Button>
        </div>
      </ModalSheet>
      {sheet === 'add-source' && active && (
        <SourcePicker
          section={active}
          onClose={() => showSheet(null)}
          onApply={(sources) => {
            sectionUpdate(active.id, sectionWithSources(active, sources));
            showSheet(null);
          }}
        />
      )}
      {sheet === 'schedule' && (
        <ScheduleEditor
          id={props.id}
          draft={draft}
          saveError={failed ? status : ''}
          onClose={() => showSheet(null)}
          onApply={applySettings}
        />
      )}
      <ModalSheet open={sheet === 'brew'} title="Brew options" onClose={() => showSheet(null)}>
        <Input
          label="Brew name"
          value={draft.name}
          aria-invalid={!draft.name.trim()}
          onChange={(event) => update((current) => ({ ...current, name: event.target.value }))}
        />
      </ModalSheet>
      <ModalSheet
        open={sheet === 'section-options' && !!active}
        title={`Options · ${active?.title ?? 'Section'}`}
        onClose={() => {
          showSheet(null);
          setConfirmRemove(false);
        }}
      >
        <div className="compose-section-options">
          <fieldset>
            <legend>Only include on these days</legend>
            <p>Leave every day unselected to include this section every day.</p>
            <div className="compose-day-choices">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => (
                <Button
                  key={day}
                  size="sm"
                  variant={active?.days?.includes(index) ? 'primary' : 'secondary'}
                  aria-pressed={active?.days?.includes(index) ?? false}
                  onClick={() => {
                    if (active)
                      sectionUpdate(active.id, {
                        days: active.days?.includes(index)
                          ? active.days.filter((value) => value !== index)
                          : [...(active.days ?? []), index],
                      });
                  }}
                >
                  {day}
                </Button>
              ))}
            </div>
          </fieldset>
          {confirmRemove ? (
            <div role="alert">
              <p>Remove this section? Your library will not change.</p>
              <Button variant="secondary" onClick={() => setConfirmRemove(false)}>
                Cancel removal
              </Button>
              <Button onClick={remove}>Remove section</Button>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setConfirmRemove(true)}>
              Remove section
            </Button>
          )}
        </div>
      </ModalSheet>
    </div>
  );
}

const fieldOptions = ['title', 'content', 'author', 'url', 'feed', 'folder'].map((value) => ({
  value,
  label: value,
}));
const operatorOptions = [
  ['contains', 'contains'],
  ['not_contains', 'does not contain'],
  ['equals', 'is'],
  ['starts_with', 'starts with'],
  ['ends_with', 'ends with'],
  ['matches_regex', 'matches regex'],
].map(([value, label]) => ({ value: value!, label: label! }));
function SectionFilter({
  section,
  onChange,
  matches,
  onOptions,
}: {
  section: BrewSection;
  onChange: (filter: BrewSection['filter']) => void;
  matches?: BrewPreview['snapshot']['sections'][number];
  onOptions: () => void;
}) {
  const filter = section.filter ?? { match: 'all' as const, conditions: [] };
  const condition = (index: number, partial: Partial<(typeof filter.conditions)[number]>) =>
    onChange({
      ...filter,
      conditions: filter.conditions.map((value, position) =>
        position === index ? { ...value, ...partial } : value,
      ),
    });
  return (
    <div className="compose-filter">
      <div className="compose-filter-sentence">
        <span>Only items where</span>
        {!filter.conditions.length && <span>any item matches</span>}
        {filter.conditions.map((value, index) => (
          <span className="compose-condition" key={index}>
            {index > 0 && (
              <SentenceToken
                size="sm"
                label={`Condition ${index + 1} match`}
                value={filter.match}
                options={[
                  { value: 'all', label: 'and' },
                  { value: 'any', label: 'or' },
                ]}
                onValueChange={(match) => onChange({ ...filter, match: match as 'all' | 'any' })}
              />
            )}
            <SentenceToken
              size="sm"
              label={`Condition ${index + 1} field`}
              value={value.field}
              options={fieldOptions}
              onValueChange={(field) => condition(index, { field: field as typeof value.field })}
            />
            <SentenceToken
              size="sm"
              label={`Condition ${index + 1} operator`}
              value={value.operator}
              options={operatorOptions}
              onValueChange={(operator) =>
                condition(index, { operator: operator as typeof value.operator })
              }
            />
            <SentenceToken
              size="sm"
              kind="value"
              label={`Condition ${index + 1} value`}
              value={value.value}
              onValueChange={(value) => condition(index, { value })}
            />
            <IconButton
              icon="x"
              label={`Remove condition ${index + 1}`}
              onClick={() =>
                onChange({
                  ...filter,
                  conditions: filter.conditions.filter((_, position) => position !== index),
                })
              }
            />
          </span>
        ))}
      </div>
      <footer>
        <button
          className="compose-link"
          type="button"
          onClick={() =>
            onChange({
              ...filter,
              conditions: [
                ...filter.conditions,
                { field: 'title', operator: 'contains', value: '' },
              ],
            })
          }
        >
          + Condition
        </button>
        <span className="brew-spacer" />
        <span className="compose-caption">
          {matches
            ? `Matches ${matches.matchingItems} of ${matches.eligibleItems}${section.onlyUnread ? ' unread' : ''} now`
            : 'Updating matches…'}
        </span>
        <IconButton icon="more" label="Section options" onClick={onOptions} />
      </footer>
    </div>
  );
}
