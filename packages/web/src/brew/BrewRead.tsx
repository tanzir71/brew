import { useEffect, useRef, useState, lazy, Suspense, type CSSProperties } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBrewReadState } from './useBrewReadState';
import type {
  BrewArticleState,
  BrewConfig,
  BrewItem,
  BrewReadState,
  BrewSnapshot,
} from '@brew/core/types/brew';
import type { ArticleDetail } from '@brew/core/types/api';
import { Avatar, Button, Chip } from '../components/controls';
import { Icon } from '../components/Icon';
import { Badge } from '../components/Badge';
import { ModalSheet } from '../components/Sheet';
const ArticleReader = lazy(() =>
  import('../Reader').then((module) => ({ default: module.ArticleReader })),
);

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error('Could not update this Brew. Try again.');
  return response.json() as Promise<T>;
}
const numberWords = (value: number): string => {
  const small = [
    'zero',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen',
  ];
  if (value < 20) return small[value]!;
  if (value < 100)
    return (
      ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'][
        Math.floor(value / 10)
      ] + (value % 10 ? `-${small[value % 10]}` : '')
    );
  return String(value);
};
const sectionAnchor = (id: string) => `section-${encodeURIComponent(id)}`;
const format = (date: string, options: Intl.DateTimeFormatOptions, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { ...options, timeZone }).format(new Date(date));
function imageSource(value: string) {
  if (value.startsWith('/figma/')) return value;
  const proxied = value.startsWith('/api/img?');
  return localStorage.getItem('brew:direct-images') === 'true'
    ? proxied
      ? (new URL(value, location.origin).searchParams.get('src') ?? value)
      : value
    : proxied
      ? value
      : `/api/img?src=${encodeURIComponent(value)}`;
}

export function BrewRead({
  snapshot,
  config,
  previous,
  onSelect,
  onCompose,
  markAllRequested,
  onMarkAllClosed,
}: {
  snapshot: BrewSnapshot | null;
  config?: BrewConfig;
  previous?: BrewSnapshot;
  onSelect: (issue: BrewSnapshot) => void;
  onCompose: () => void;
  markAllRequested: boolean;
  onMarkAllClosed: () => void;
}) {
  const client = useQueryClient();
  const state = useBrewReadState(snapshot?.id);
  const initialSelected = Number(new URLSearchParams(location.search).get('selected'));
  const [selected, setSelected] = useState<number | null>(
    initialSelected > 0 ? initialSelected : null,
  );
  const [open, setOpen] = useState<number | null>(null);
  const [activeSection, setActiveSection] = useState(snapshot?.sections[0]?.id ?? '');
  const [confirm, setConfirm] = useState<{ title: string; ids: number[] } | null>(null);
  const [undo, setUndo] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!snapshot) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveSection((visible.target as HTMLElement).dataset.sectionId!);
      },
      { rootMargin: '-80px 0px -60% 0px' },
    );
    for (const element of document.querySelectorAll('[data-section-id]')) observer.observe(element);
    return () => observer.disconnect();
  }, [snapshot]);
  if (!snapshot)
    return (
      <main className="brew-empty">
        <p>Your morning paper</p>
        <h1 className="type-display-l">Nothing has been brewed yet.</h1>
        <p>Compose a few sections, then generate your first frozen edition.</p>
        <Button onClick={onCompose}>Compose your Brew</Button>
      </main>
    );

  const items = [
    ...new Map(
      snapshot.sections.flatMap((section) => section.items).map((item) => [item.id, item]),
    ).values(),
  ];
  const current = (item: BrewItem): BrewArticleState =>
    (state.isError ? undefined : state.data)?.articles.find((entry) => entry.id === item.id) ?? {
      id: item.id,
      feedId: null,
      available: false,
      readAt: item.readAt,
      starredAt: null,
      highlightColor: null,
      rules: [],
    };
  const read = items.filter((item) => current(item).readAt).length;
  const minutes = items.reduce((sum, item) => sum + item.readTimeMinutes, 0);
  const remaining = items
    .filter((item) => !current(item).readAt)
    .reduce((sum, item) => sum + item.readTimeMinutes, 0);
  const sources = new Set(items.map((item) => current(item).feedId ?? item.feedTitle)).size;
  const rules = new Set(
    state.data?.articles.flatMap((item) => item.rules.map((rule) => rule.id)) ?? [],
  ).size;
  const timeZone = state.data?.timeZone ?? 'UTC';
  const choose = (id: number) => {
    void import('../Reader');
    setSelected(id);
    const url = new URL(location.href);
    url.searchParams.set('selected', String(id));
    window.history.replaceState({}, '', url);
  };
  const update = async (id: number, values: { read?: boolean; starred?: boolean }) => {
    const next = await json<ArticleDetail>(`/api/articles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    client.setQueryData<BrewReadState>(['brew-state', snapshot.id], (old) =>
      old
        ? {
            ...old,
            articles: old.articles.map((item) =>
              item.id === id ? { ...item, readAt: next.readAt, starredAt: next.starredAt } : item,
            ),
          }
        : old,
    );
    client.setQueryData(['article', id], next);
    void client.invalidateQueries({ queryKey: ['reader-navigation'] });
    void client.invalidateQueries({ queryKey: ['articles'] });
  };
  const change = async (id: number, values: { read?: boolean; starred?: boolean }) => {
    setUndo([]);
    setBusy(true);
    try {
      await update(id, values);
      setMessage(
        values.starred === undefined
          ? values.read
            ? 'Marked read.'
            : 'Marked unread.'
          : values.starred
            ? 'Saved to Starred.'
            : 'Removed from Starred.',
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const markIds = async (ids: number[], value: boolean) => {
    setBusy(true);
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        await update(id, { read: value });
        return id;
      }),
    );
    const changed = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    setUndo(value ? changed : []);
    setMessage(
      `${changed.length} marked ${value ? 'read' : 'unread'}.${changed.length < ids.length ? ` ${ids.length - changed.length} could not be updated. Try again.` : ''}`,
    );
    setBusy(false);
    setConfirm(null);
    onMarkAllClosed();
  };
  const requestIds = markAllRequested ? items.map((item) => item.id) : (confirm?.ids ?? []);
  const unreadIds = requestIds.filter((id) => {
    const item = items.find((entry) => entry.id === id);
    return item && current(item).available && !current(item).readAt;
  });
  const next = state.data?.nextAt;

  return (
    <>
      <div className="brew-read-body">
        <main className="brew-edition" data-brew-id={snapshot.id}>
          <header className="brew-masthead">
            <p className="type-ui-caption">
              <time dateTime={snapshot.generatedAt}>
                {format(
                  snapshot.generatedAt,
                  { weekday: 'long', day: 'numeric', month: 'long' },
                  timeZone,
                )}
              </time>{' '}
              · No. {snapshot.id}
            </p>
            <h1 className="type-display-l">{snapshot.configName}</h1>
            <p className="type-reading-lede">
              {items.length
                ? `${numberWords(items.length).replace(/^./, (letter) => letter.toUpperCase())} ${items.length === 1 ? 'story' : 'stories'} from ${numberWords(sources)} ${sources === 1 ? 'source' : 'sources'}. About ${numberWords(minutes)} minutes, then you’re done.`
                : 'Nothing new for this edition. Enjoy the quiet.'}
            </p>
            <div className="brew-edition-meta">
              <span>
                <Icon name="clock" size={14} />
                Made at{' '}
                {format(
                  snapshot.generatedAt,
                  { hour: '2-digit', minute: '2-digit' },
                  timeZone,
                )} · {timeZone}
              </span>
              <span>
                <Icon name="check" size={14} />
                {read} of {items.length} read
              </span>
              <span>
                <Icon name="filter" size={14} />
                {rules} {rules === 1 ? 'rule' : 'rules'} applied
              </span>
            </div>
          </header>
          {state.isError && (
            <div className="brew-read-error" role="alert">
              Live article state is unavailable.{' '}
              <Button variant="secondary" size="sm" onClick={() => void state.refetch()}>
                Retry
              </Button>
            </div>
          )}
          {snapshot.sections.map((section) => {
            const layout =
              section.layout === 'hero'
                ? 'lead'
                : section.layout === 'list'
                  ? 'headlines'
                  : section.layout;
            return (
              <section
                key={section.id}
                id={sectionAnchor(section.id)}
                data-section-id={section.id}
                data-brew-kind="section"
                data-brew-id={section.id}
                className="brew-edition-section"
                aria-labelledby={`heading-${sectionAnchor(section.id)}`}
              >
                <header>
                  <h2 id={`heading-${sectionAnchor(section.id)}`} className="type-title-l">
                    {section.title}
                  </h2>
                  <span className="brew-spacer" />
                  <span className="brew-section-total">
                    {section.items.length} {section.items.length === 1 ? 'story' : 'stories'} ·{' '}
                    {section.items.reduce((sum, item) => sum + item.readTimeMinutes, 0)} min
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Icon name="check" size={14} />}
                    disabled={
                      busy ||
                      !state.data ||
                      !section.items.some(
                        (item) => current(item).available && !current(item).readAt,
                      )
                    }
                    onClick={() =>
                      setConfirm({
                        title: section.title,
                        ids: section.items.map((item) => item.id),
                      })
                    }
                  >
                    Mark section read
                  </Button>
                </header>
                {section.divider && (
                  <p className="brew-section-lede type-reading-lede">{section.divider}</p>
                )}
                {!section.items.length ? (
                  <p className="brew-section-empty">No stories for this section today.</p>
                ) : (
                  <div className={`brew-layout brew-layout--${layout}`}>
                    {section.items.map((item, index) => (
                      <ReadItem
                        key={item.id}
                        item={item}
                        state={current(item)}
                        layout={layout === 'lead' ? (index === 0 ? 'lead' : 'magazine') : layout}
                        selected={selected === item.id}
                        busy={busy}
                        onSelect={() => choose(item.id)}
                        onOpen={async () => {
                          opener.current = document.activeElement as HTMLElement;
                          try {
                            if (!current(item).readAt) await update(item.id, { read: true });
                            setOpen(item.id);
                          } catch (error) {
                            setMessage((error as Error).message);
                          }
                        }}
                        onStar={() => void change(item.id, { starred: !current(item).starredAt })}
                        onRead={() => void change(item.id, { read: !current(item).readAt })}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
          <footer className="brew-edition-end">
            <Icon name="brew" size={22} />
            <h2 className="type-reading-lede">That’s the whole Brew.</h2>
            <p>
              {next
                ? `The next one is made ${format(next, { weekday: 'long', hour: '2-digit', minute: '2-digit' }, timeZone)}.`
                : config?.enabled
                  ? 'Your next Brew follows the server schedule.'
                  : 'Your schedule is paused. Make another Brew whenever you’re ready.'}
            </p>
            <div>
              <Button
                variant="secondary"
                size="sm"
                icon={<Icon name="chevron-left" size={14} />}
                disabled={!previous}
                onClick={() => previous && onSelect(previous)}
              >
                Read yesterday’s
              </Button>
              <a href="/?view=reader&scope=all">
                Browse all articles <Icon name="arrow-right" size={14} />
              </a>
            </div>
          </footer>
        </main>
        <aside className="brew-reading-rail" aria-label="In this Brew">
          <h2>In this Brew</h2>
          <nav aria-label="Brew contents">
            {snapshot.sections.map((section) => (
              <a
                key={section.id}
                href={`#${sectionAnchor(section.id)}`}
                aria-current={activeSection === section.id ? 'location' : undefined}
                onClick={() => setActiveSection(section.id)}
              >
                <span>{section.title}</span>
                <span>{section.items.length}</span>
              </a>
            ))}
          </nav>
          <div className="brew-reading-progress">
            <div>
              <span>
                {read} of {items.length} read
              </span>
              <span>{remaining} min left</span>
            </div>
            <progress
              aria-label="Brew reading progress"
              max={Math.max(1, items.length)}
              value={read}
            />
          </div>
          <div className="brew-format-links">
            <h2>Open this Brew as</h2>
            {(
              [
                ['file', 'Markdown', `.md`],
                ['code', 'JSON', '.json'],
                ['rss', 'Atom feed', '.atom'],
              ] as const
            ).map(([icon, label, suffix]) => (
              <div key={label}>
                <button disabled>
                  <Icon name={icon} size={14} />
                  {label}
                </button>
                <code>
                  /b/{snapshot.brewConfigId}
                  {suffix === '.atom' ? '' : `/${snapshot.id}`}
                  {suffix}
                </code>
              </div>
            ))}
            <p>
              <Badge tone="locked">Not available yet</Badge>{' '}
              <a href="/settings/runs#setup-data">About formats</a>
            </p>
          </div>
          <div className="brew-next">
            <h2>Next Brew</h2>
            <p>
              {next
                ? format(
                    next,
                    {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    },
                    timeZone,
                  )
                : 'Not scheduled'}
            </p>
            <p>
              {state.data?.scheduleLabel ?? 'Server schedule'} · {timeZone}
            </p>
          </div>
        </aside>
      </div>
      <div role="status" aria-live="polite" className={message ? 'brew-read-status' : 'sr-only'}>
        {message}
        {undo.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void markIds(undo, false)}
          >
            Undo
          </Button>
        )}
      </div>
      <ModalSheet
        open={markAllRequested || !!confirm}
        onClose={() => {
          setConfirm(null);
          onMarkAllClosed();
        }}
        title={
          markAllRequested ? 'Mark this Brew read?' : `Mark ${confirm?.title ?? 'section'} read?`
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirm(null);
                onMarkAllClosed();
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              disabled={busy || !unreadIds.length}
              onClick={() => void markIds(unreadIds, true)}
            >
              Mark {unreadIds.length} read
            </Button>
          </>
        }
      >
        <p>
          {unreadIds.length} unread {unreadIds.length === 1 ? 'story' : 'stories'} will also be
          marked read in your library. You can undo this.
        </p>
      </ModalSheet>
      {open !== null && (
        <Suspense fallback={<p role="status">Loading article…</p>}>
          <ArticleReader
            id={open}
            mode="overlay"
            onClose={() => {
              setOpen(null);
              void state.refetch();
              opener.current?.focus();
            }}
          />
        </Suspense>
      )}
    </>
  );
}

function ReadItem({
  item,
  state,
  layout,
  selected,
  busy,
  onSelect,
  onOpen,
  onStar,
  onRead,
}: {
  item: BrewItem;
  state: BrewArticleState;
  layout: string;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onStar: () => void;
  onRead: () => void;
}) {
  const highlighted = !!state.highlightColor;
  return (
    <article
      className={`brew-read-item brew-read-item--${layout}`}
      aria-label={item.title}
      data-brew-id={item.id}
      data-brew-kind="article"
      data-brew-state={[
        state.readAt ? 'read' : 'unread',
        state.starredAt ? 'starred' : '',
        highlighted ? 'highlighted' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-selected={selected}
      style={
        highlighted ? ({ '--item-highlight': state.highlightColor } as CSSProperties) : undefined
      }
      onFocusCapture={onSelect}
    >
      {layout === 'lead' && item.imageUrl && (
        <img className="brew-hero-image" src={imageSource(item.imageUrl)} alt="" />
      )}
      <div className="brew-read-item-body">
        <div className="brew-read-item-copy">
          <div className="brew-read-source">
            <Avatar id={state.feedId ?? item.feedTitle} initial={item.feedTitle.slice(0, 1)} />
            <span>{item.feedTitle}</span>
            <span>
              · {item.readTimeMinutes} min{layout === 'lead' ? ' read' : ''}
            </span>
            {state.readAt && (
              <span>
                <Icon name="check" size={12} />
                Read
              </span>
            )}
          </div>
          <h3
            className={
              layout === 'lead'
                ? 'type-title-l'
                : layout === 'headlines'
                  ? 'type-ui-body'
                  : 'type-title-s'
            }
          >
            <button type="button" aria-pressed={selected} onClick={onSelect}>
              {item.title}
            </button>
          </h3>
          {layout !== 'headlines' && item.summaryHtml && (
            <div
              className="brew-read-excerpt"
              dangerouslySetInnerHTML={{ __html: item.summaryHtml }}
            />
          )}
        </div>
        {layout === 'magazine' && item.imageUrl && (
          <img
            className="brew-magazine-image"
            src={imageSource(item.imageUrl)}
            alt=""
            width="120"
            height="84"
          />
        )}
        {layout === 'headlines' && (
          <>
            <span className="brew-headline-source">{item.feedTitle}</span>
            <span className="brew-headline-time">{item.readTimeMinutes} min</span>
          </>
        )}
      </div>
      <div className="brew-read-actions">
        <Button
          variant="secondary"
          size="sm"
          icon={<Icon name="read" size={14} />}
          data-brew-action="open"
          disabled={!state.available || busy}
          onClick={onOpen}
        >
          Open
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<Icon name="star" size={14} />}
          data-brew-action="star"
          disabled={!state.available || busy}
          aria-pressed={!!state.starredAt}
          onClick={onStar}
        >
          {state.starredAt ? 'Starred' : 'Star'}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<Icon name="check" size={14} />}
          data-brew-action="mark-read"
          disabled={!state.available || busy}
          onClick={onRead}
        >
          {state.readAt ? 'Mark unread' : 'Mark read'}
        </Button>
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open original · ${item.title}`}
        >
          <Icon name="external" size={14} />
        </a>
        <span className="brew-spacer" />
        {highlighted &&
          state.rules.map((rule) => (
            <a key={rule.id} href={`/?view=rules&rule=${rule.id}`}>
              <Chip icon={<Icon name="rules" size={14} />}>Rule · {rule.name}</Chip>
            </a>
          ))}
        {!state.available && <span className="brew-item-unavailable">Article unavailable</span>}
      </div>
    </article>
  );
}
