import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ArticleDetail, TagSummary } from '@brew/core/types/api';
import { articleDom } from './articleDom';
import { useArticleAlternates } from './hooks/useArticleAlternates';
import { useCapabilities } from './hooks/useCapabilities';
import { useBrowserPreferences } from './hooks/useBrowserPreferences';
import { PreferenceFeedback } from './settings/BrowserPreferences';
import { ModalSheet } from './components/Sheet';
import { Badge } from './components/Badge';
import { updateArticleState } from './articleState';
import { lockDialogScroll } from './dialogScrollLock';
import { containDialogBlur, containDialogTab } from './dialogFocus';

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Could not load this article');
  return response.json() as Promise<T>;
}

type ArticleReaderProps = {
  id: number;
  mode: 'overlay' | 'pane';
  onClose: () => void;
  returnFocus?: () => HTMLElement | null;
  initialTags?: boolean;
};

export function ArticleReader(props: ArticleReaderProps) {
  return <ArticleReaderBody key={`${props.id}:${Boolean(props.initialTags)}`} {...props} />;
}

function ArticleReaderBody({
  id,
  mode,
  onClose,
  returnFocus,
  initialTags = false,
}: ArticleReaderProps) {
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ['article', id],
    staleTime: 0,
    queryFn: ({ signal }) => getJson<ArticleDetail>(`/api/articles/${id}`, signal),
  });
  const opened = useRef<number | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [message, setMessage] = useState('');
  const [showTags, setShowTags] = useState(initialTags);
  const [smallScreen, setSmallScreen] = useState(() => matchMedia('(max-width: 899px)').matches);
  const modal = mode === 'overlay' || smallScreen;
  const [menu, setMenu] = useState({ modal, open: false, returnToMore: false });
  // Reset before committing a new presentation, so its parent cannot cover More.
  if (menu.modal !== modal) setMenu({ modal, open: false, returnToMore: menu.open });
  const more = menu.modal === modal && menu.open;
  const setMore = (open: boolean) => setMenu((current) => ({ ...current, open }));
  const dialogRef = useRef<HTMLDialogElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const tagsRef = useRef<HTMLDivElement>(null);
  const focusTags = useRef(initialTags);
  const alive = useRef(false);
  const extractRequest = useRef<AbortController | null>(null);
  const focused = useRef(false);
  const backdropStart = useRef(false);
  const returnTarget = useRef(returnFocus);
  useLayoutEffect(() => {
    returnTarget.current = returnFocus;
  }, [returnFocus]);
  const formats = useCapabilities();
  useArticleAlternates(detail.data?.id ?? null);
  const preferences = useBrowserPreferences();
  const readingPrefs = preferences.values;
  useEffect(() => {
    const media = matchMedia('(max-width: 899px)');
    const change = () => setSmallScreen(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useLayoutEffect(() => {
    alive.current = true;
    const previous = document.activeElement as HTMLElement | null;
    const scope = location.pathname + location.search;
    return () => {
      alive.current = false;
      extractRequest.current?.abort();
      requestAnimationFrame(() => {
        if (
          alive.current ||
          scope !== location.pathname + location.search ||
          document.querySelector('dialog[open]')
        )
          return;
        const target = returnTarget.current?.() ?? previous;
        const box = target?.getBoundingClientRect();
        if (
          target?.isConnected &&
          target !== document.body &&
          box &&
          box.width > 0 &&
          box.height > 0 &&
          box.bottom > 0 &&
          box.top < innerHeight &&
          !target.matches(':disabled')
        ) {
          target.focus({ preventScroll: true });
        } else
          document.querySelector<HTMLElement>('main h1[tabindex]')?.focus({ preventScroll: true });
      });
    };
  }, []);
  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    const unlock = modal ? lockDialogScroll() : () => {};
    if (modal) dialog.showModal();
    else dialog.show();
    (
      (menu.returnToMore ? moreRef.current : contentRef.current) ??
      dialog.querySelector<HTMLElement>('button')
    )?.focus({
      preventScroll: true,
    });
    return () => {
      dialog.close();
      unlock();
    };
  }, [menu.returnToMore, modal]);
  useLayoutEffect(() => {
    if (detail.data && !focused.current && contentRef.current) {
      focused.current = true;
      contentRef.current.focus({ preventScroll: true });
    }
  }, [detail.data]);
  useEffect(() => {
    if (!focusTags.current || !showTags || more) return;
    const frame = requestAnimationFrame(() => {
      if (!tagsRef.current) return;
      focusTags.current = false;
      tagsRef.current.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [detail.data?.id, more, showTags]);
  const extract = async () => {
    if (extractRequest.current) return;
    const request = new AbortController();
    extractRequest.current = request;
    setExtracting(true);
    setMessage('');
    try {
      const response = await fetch(`/api/articles/${id}/full-text`, {
        method: 'POST',
        signal: request.signal,
      });
      const body = (await response.json()) as ArticleDetail & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Could not load full article');
      if (alive.current) client.setQueryData(['article', id], body);
    } catch (error) {
      if (alive.current && !request.signal.aborted)
        setMessage(error instanceof Error ? error.message : 'Could not load full article');
    } finally {
      extractRequest.current = null;
      if (alive.current) setExtracting(false);
    }
  };
  const copy = async () => {
    if (!detail.data) return;
    try {
      await navigator.clipboard.writeText(detail.data.url);
      if (alive.current) setMessage('Link copied.');
    } catch {
      if (alive.current) setMessage('Could not copy the link. Try again or use View original.');
    }
  };
  const updateState = async (values: { read?: boolean; starred?: boolean }) => {
    setMessage('');
    try {
      await updateArticleState(client, id, values);
    } catch (error) {
      if (alive.current) setMessage((error as Error).message);
    }
  };
  useEffect(() => {
    if (!detail.data || detail.isFetching || detail.isError || opened.current === id) return;
    opened.current = id;
    if (!detail.data.readAt)
      void updateArticleState(client, id, { read: true }).catch((error: Error) => {
        if (alive.current) setMessage(error.message);
      });
  }, [client, detail.data, detail.isError, detail.isFetching, id]);
  return (
    <>
      <dialog
        ref={dialogRef}
        className={`article-reader article-reader--${modal ? 'overlay' : 'pane'}`}
        aria-modal={modal}
        aria-label="Article reader"
        onCancel={(event) => {
          event.preventDefault();
          if (!more) onClose();
        }}
        onPointerDown={(event) => {
          backdropStart.current = event.target === event.currentTarget;
        }}
        onClick={(event) => {
          if (modal && backdropStart.current && event.target === event.currentTarget) onClose();
        }}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey || more) return;
          if (!modal && event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
          }
          const target = event.target as HTMLElement;
          if (target.matches('input,textarea,select,audio,video') || target.isContentEditable)
            return;
          const key = event.key.toLowerCase();
          if (['m', 's', 't'].includes(key)) {
            event.preventDefault();
            event.currentTarget
              .querySelector<HTMLButtonElement>(`[data-shortcut="${key}"]`)
              ?.click();
          } else if (key === 'v') {
            event.preventDefault();
            event.currentTarget
              .querySelector<HTMLAnchorElement>('[data-brew-action="view-original"]')
              ?.click();
          }
        }}
        onKeyDownCapture={(event) => {
          if (modal && !more) containDialogTab(event);
        }}
        onBlurCapture={containDialogBlur}
      >
        <div className="article-reader-surface overflow-y-auto bg-surface shadow-overlay">
          <div className="article-reader-toolbar sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface/95 px-6 py-3 backdrop-blur">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={onClose}
                aria-label="Close article"
                data-brew-action="close"
                className="rounded-full px-3 py-2 text-soft hover:bg-subtle"
              >
                ✕
              </button>
              {detail.data && (
                <>
                  <a
                    href={detail.data.url}
                    data-brew-action="view-original"
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg px-3 py-2 text-xs font-medium hover:bg-subtle"
                  >
                    View original ↗
                  </a>
                  <button
                    onClick={copy}
                    className="rounded-lg px-3 py-2 text-xs font-medium hover:bg-subtle"
                  >
                    Copy link
                  </button>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-1" aria-label="Reading preferences">
              <select
                aria-label="Reader font"
                data-brew-action="set-reader-font"
                value={readingPrefs.font}
                onChange={(event) => preferences.save('font', event.target.value, 'Reader font')}
                className="rounded border px-2 py-1 text-xs"
              >
                <option value="sans">Sans</option>
                <option value="serif">Serif</option>
              </select>
              <select
                aria-label="Reader width"
                data-brew-action="set-reader-width"
                value={readingPrefs.width}
                onChange={(event) => preferences.save('width', event.target.value, 'Reader width')}
                className="rounded border px-2 py-1 text-xs"
              >
                <option value="narrow">Narrow</option>
                <option value="wide">Wide</option>
              </select>
              <select
                aria-label="Reader line height"
                data-brew-action="set-reader-line-height"
                value={readingPrefs.lineHeight}
                onChange={(event) =>
                  preferences.save('lineHeight', event.target.value, 'Reader line height')
                }
                className="rounded border px-2 py-1 text-xs"
              >
                <option value="compact">Compact</option>
                <option value="relaxed">Relaxed</option>
              </select>
              <button
                ref={moreRef}
                type="button"
                aria-label="More article actions"
                data-brew-action="more"
                onClick={() => setMore(true)}
                className="rounded border px-2 py-1 text-xs"
              >
                More
              </button>
            </div>
          </div>
          <PreferenceFeedback preferences={preferences} name="Article preferences result" />
          {detail.isLoading ? (
            <p role="status" className="p-12 text-center text-sm text-soft">
              Opening article…
            </p>
          ) : detail.isError || !detail.data ? (
            <div className="p-12 text-center text-sm">
              <p role="alert" className="text-danger">
                Could not open this article.
              </p>
              <button
                type="button"
                className="brew-button brew-button--secondary mt-4"
                data-brew-action="retry"
                disabled={detail.isFetching}
                onClick={() => void detail.refetch()}
              >
                {detail.isFetching ? 'Retrying…' : 'Retry article'}
              </button>
            </div>
          ) : (
            <article
              ref={contentRef}
              tabIndex={-1}
              aria-label={detail.data.title}
              {...articleDom(detail.data)}
              className={`mx-auto break-words px-7 py-12 ${readingPrefs.width === 'wide' ? 'max-w-[880px]' : 'max-w-[680px]'}`}
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-soft">
                {detail.data.feedTitle}
              </p>
              <h1 className="mt-3 type-display-l">{detail.data.title}</h1>
              <div className="mt-4 flex flex-wrap gap-2 text-sm text-soft">
                {detail.data.author && <span>By {detail.data.author}</span>}
                <span>{detail.data.readTimeMinutes} min read</span>
                <time>
                  {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
                    new Date(detail.data.publishedAt),
                  )}
                </time>
              </div>
              <div className="mt-6 flex flex-wrap gap-2">
                <button
                  data-shortcut="m"
                  data-brew-action="mark-read"
                  onClick={() => updateState({ read: !detail.data.readAt })}
                  className="rounded-full border border-line-strong px-4 py-2 text-sm font-semibold"
                >
                  {detail.data.readAt ? 'Mark unread' : 'Mark read'}
                </button>
                <button
                  data-shortcut="s"
                  data-brew-action="star"
                  onClick={() => updateState({ starred: !detail.data.starredAt })}
                  aria-pressed={Boolean(detail.data.starredAt)}
                  className={`rounded-full border px-4 py-2 text-sm font-semibold ${detail.data.starredAt ? 'starred-burst border-line-strong bg-subtle text-soft' : 'border-line-strong'}`}
                >
                  {detail.data.starredAt ? '★ Starred' : '☆ Star'}
                </button>
                <button
                  data-shortcut="t"
                  data-brew-action="tag"
                  aria-expanded={showTags}
                  aria-controls={`article-tags-${id}`}
                  onClick={() => {
                    focusTags.current = !showTags;
                    setShowTags(!showTags);
                  }}
                  className="rounded-full border border-line-strong px-4 py-2 text-sm font-semibold"
                >
                  Tag{detail.data.tags.length ? ` · ${detail.data.tags.length}` : ''}
                </button>
              </div>
              {showTags && (
                <div
                  ref={tagsRef}
                  id={`article-tags-${id}`}
                  tabIndex={-1}
                  role="region"
                  aria-label="Article tags"
                >
                  <TagEditor
                    article={detail.data}
                    onChange={(next) => client.setQueryData(['article', id], next)}
                  />
                </div>
              )}{' '}
              {!detail.data.fullTextHtml && (
                <button
                  disabled={extracting}
                  onClick={extract}
                  className="mt-8 rounded-full border border-line-strong px-4 py-2 text-sm font-semibold hover:bg-canvas disabled:opacity-50"
                >
                  {extracting ? 'Loading full article…' : 'Load full article'}
                </button>
              )}
              {message && (
                <p role="status" aria-live="polite" className="mt-3 text-sm text-soft">
                  {message}
                </p>
              )}
              {detail.data.enclosureUrl && detail.data.enclosureType?.startsWith('audio/') && (
                <audio
                  aria-label={`Listen to ${detail.data.title}`}
                  controls
                  preload="none"
                  className="mt-7 w-full"
                  src={`/api/media?src=${encodeURIComponent(detail.data.enclosureUrl)}`}
                />
              )}
              <div
                data-reading-font={readingPrefs.font ?? 'serif'}
                data-reading-line-height={readingPrefs.lineHeight ?? 'relaxed'}
                className={`article-content mt-9 type-reading-body text-ink [&_a]:text-accent [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-5 [&_h2]:mt-9 [&_h2]:text-2xl [&_img]:my-7 [&_img]:h-auto [&_img]:max-w-full [&_p]:my-5`}
                dangerouslySetInnerHTML={{
                  __html:
                    detail.data.fullTextHtml ??
                    detail.data.contentHtml ??
                    detail.data.summaryHtml ??
                    '<p>No article content was provided.</p>',
                }}
              />
            </article>
          )}
        </div>
      </dialog>
      <ModalSheet
        open={more}
        onClose={() => setMore(false)}
        title="Article actions"
        returnFocusRef={moreRef}
      >
        {detail.data && (
          <div className="grid gap-3">
            <button
              type="button"
              className="brew-button brew-button--secondary brew-button--sm"
              data-brew-action="mark-read"
              onClick={() => void updateState({ read: !detail.data.readAt })}
            >
              {detail.data.readAt ? 'Mark unread' : 'Mark read'}
            </button>
            <button
              type="button"
              className="brew-button brew-button--secondary brew-button--sm"
              data-brew-action="star"
              aria-pressed={Boolean(detail.data.starredAt)}
              onClick={() => void updateState({ starred: !detail.data.starredAt })}
            >
              {detail.data.starredAt ? 'Unstar' : 'Star'}
            </button>
            <button
              type="button"
              className="brew-button brew-button--secondary brew-button--sm"
              data-brew-action="tag"
              onClick={() => {
                focusTags.current = true;
                setMore(false);
                setShowTags(true);
              }}
            >
              Tag
            </button>
            {(['md', 'json'] as const).map((format) =>
              formats.data?.outputs?.twins ? (
                <a
                  key={format}
                  className="brew-button brew-button--secondary brew-button--sm"
                  data-brew-action="export"
                  href={`/a/${id}.${format}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {format === 'md' ? 'Markdown' : 'JSON'}
                </a>
              ) : (
                <button
                  key={format}
                  type="button"
                  disabled
                  data-brew-action="export"
                  className="brew-button brew-button--secondary brew-button--sm"
                  aria-label={`${format === 'md' ? 'Markdown' : 'JSON'} · ${formats.isError ? 'Formats unavailable' : 'Needs setup'}`}
                >
                  {format === 'md' ? 'Markdown' : 'JSON'}
                  <Badge tone="warning">
                    {formats.isError ? 'Formats unavailable' : 'Needs setup'}
                  </Badge>
                </button>
              ),
            )}
            {!formats.data?.outputs?.twins && <a href="/settings/runs">Set up article outputs</a>}
            <a href={detail.data.url} target="_blank" rel="noreferrer">
              View original
            </a>
          </div>
        )}
      </ModalSheet>
    </>
  );
}

function TagEditor({
  article,
  onChange,
}: {
  article: ArticleDetail;
  onChange: (article: ArticleDetail) => void;
}) {
  const client = useQueryClient();
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => getJson<TagSummary[]>('/api/tags') });
  const [name, setName] = useState('');
  const save = async (selected: TagSummary[]) => {
    const previous = article.tags;
    onChange({ ...article, tags: selected });
    const response = await fetch(`/api/articles/${article.id}/tags`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagIds: selected.map((tag) => tag.id) }),
    });
    if (response.ok) onChange((await response.json()) as ArticleDetail);
    else onChange({ ...article, tags: previous });
  };
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    const response = await fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) return;
    const tag = (await response.json()) as TagSummary;
    client.setQueryData<TagSummary[]>(['tags'], (current) =>
      [...(current ?? []).filter((item) => item.id !== tag.id), tag].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    );
    setName('');
    await save([...article.tags, tag]);
  };
  return (
    <div className="mt-4 rounded-2xl border border-line bg-canvas p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-soft">Tags</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {tags.data?.map((tag) => {
          const active = article.tags.some((item) => item.id === tag.id);
          return (
            <button
              key={tag.id}
              aria-pressed={active}
              onClick={() =>
                save(
                  active
                    ? article.tags.filter((item) => item.id !== tag.id)
                    : [...article.tags, tag],
                )
              }
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${active ? 'bg-inverse text-on-inverse' : 'border border-line-strong bg-surface'}`}
            >
              {tag.name}
            </button>
          );
        })}
      </div>
      <form onSubmit={create} className="mt-3 flex gap-2">
        <label className="sr-only" htmlFor={`new-tag-${article.id}`}>
          New tag
        </label>
        <input
          id={`new-tag-${article.id}`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New tag"
          className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm"
        />
        <button className="rounded-lg bg-inverse px-3 text-xs font-semibold text-on-inverse">
          Add
        </button>
      </form>
    </div>
  );
}
