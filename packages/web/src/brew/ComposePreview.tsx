import { useEffect, useState } from 'react';
import type { BrewConfigDraft, BrewPreview, BrewSnapshotSection } from '@brew/core/types/brew';
import { Button, Avatar, SegmentedControl } from '../components/controls';
import { Badge } from '../components/Badge';
import { Icon } from '../components/Icon';
import { composeJson } from './useComposeDraft';

export function ComposePreview({
  draft,
  id,
  expanded,
  onEdit,
  onPreview,
}: {
  draft: BrewConfigDraft;
  id: number;
  expanded: string | null;
  onEdit: (id: string) => void;
  onPreview: (value: BrewPreview, draft: BrewConfigDraft) => void;
}) {
  const [preview, setPreview] = useState<BrewPreview | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [format, setFormat] = useState(() => {
    const value = new URLSearchParams(location.search).get('format');
    return value && ['web', 'email', 'feed'].includes(value) ? value : 'web';
  });
  const [device, setDevice] = useState(() =>
    new URLSearchParams(location.search).get('device') === 'phone' ? 'phone' : 'desktop',
  );
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setPending(true);
      void composeJson<BrewPreview>(`/api/brew-configs/${id}/preview`, {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({ draft }),
      })
        .then((value) => {
          if (!controller.signal.aborted) {
            setPreview(value);
            setError('');
            onPreview(value, draft);
          }
        })
        .catch((failure: Error) => {
          if (!controller.signal.aborted) setError(failure.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setPending(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [draft, id, retry, onPreview]);
  const change = (key: string, value: string) => {
    const url = new URL(location.href);
    url.searchParams.set(key, value);
    window.history.replaceState({}, '', url);
    if (key === 'format') setFormat(value);
    else setDevice(value);
  };
  const date = preview
    ? new Intl.DateTimeFormat('en-GB', {
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: draft.timezone,
      }).format(new Date(preview.snapshot.generatedAt))
    : '';
  const count = preview
    ? new Set(preview.snapshot.sections.flatMap((section) => section.items.map((item) => item.id)))
        .size
    : 0;
  const minutes = preview
    ? preview.snapshot.sections
        .flatMap((section) => section.items)
        .reduce((sum, item) => sum + item.readTimeMinutes, 0)
    : 0;
  return (
    <aside className="compose-preview" aria-label="Live preview" aria-busy={pending}>
      <div className="compose-preview-toolbar">
        <SegmentedControl
          label="Preview format"
          options={[
            { value: 'web', label: 'Web' },
            { value: 'email', label: 'Email' },
            { value: 'feed', label: 'Feed' },
          ]}
          value={format}
          onValueChange={(value) => change('format', value)}
        />
        <span className="compose-preview-next">
          <Icon name="eye" size={14} />
          Next issue · {date}, from today’s articles
        </span>
        <SegmentedControl
          label="Preview size"
          options={[
            { value: 'desktop', label: 'Desktop' },
            { value: 'phone', label: 'Phone' },
          ]}
          value={device}
          onValueChange={(value) => change('device', value)}
        />
      </div>
      {error ? (
        <div role="alert" className="compose-preview-error">
          {error}
          <Button size="sm" variant="secondary" onClick={() => setRetry((value) => value + 1)}>
            Retry preview
          </Button>
        </div>
      ) : !preview ? (
        <p role="status" className="compose-preview-error">
          Preparing preview…
        </p>
      ) : (
        <>
          {pending && (
            <p className="compose-preview-pending" role="status">
              Updating preview…
            </p>
          )}
          {format === 'web' ? (
            <article className="compose-paper" data-device={device} aria-label="Web preview">
              <p className="compose-paper-date">
                {new Intl.DateTimeFormat('en-GB', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  timeZone: draft.timezone,
                }).format(new Date(preview.snapshot.generatedAt))}{' '}
                · No. {preview.snapshot.issueNumber}
              </p>
              <h1>{draft.name}</h1>
              <p className="compose-paper-lede">
                {count} {count === 1 ? 'story' : 'stories'}, about {minutes} minutes.
              </p>
              <hr />
              {preview.snapshot.sections.map((section) => (
                <PreviewSection
                  key={section.id}
                  section={section}
                  editing={expanded === section.id}
                  onEdit={() => onEdit(section.id)}
                />
              ))}
              {expanded &&
                !preview.snapshot.sections.some((section) => section.id === expanded) && (
                  <p className="compose-preview-not-scheduled">
                    This section is not included on the next issue’s day.
                  </p>
                )}
            </article>
          ) : format === 'email' ? (
            <iframe
              title="Email preview"
              className="compose-email-preview"
              data-device={device}
              sandbox=""
              srcDoc={preview.outputs.email}
            />
          ) : (
            <div className="compose-feed-preview" data-device={device}>
              <p>Atom preview · this draft has not been published.</p>
              <pre aria-label="Atom feed preview">
                <code>{preview.outputs.feed}</code>
              </pre>
            </div>
          )}
          {preview.warnings.length > 0 && (
            <details className="compose-preview-warnings">
              <summary>
                {preview.warnings.length} preview{' '}
                {preview.warnings.length === 1 ? 'notice' : 'notices'}
              </summary>
              {preview.warnings.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </details>
          )}
        </>
      )}
    </aside>
  );
}
function sourceImage(value: string) {
  return value.startsWith('/figma/') || value.startsWith('/api/img?')
    ? value
    : `/api/img?src=${encodeURIComponent(value)}`;
}
function PreviewSection({
  section,
  editing,
  onEdit,
}: {
  section: BrewSnapshotSection;
  editing: boolean;
  onEdit: () => void;
}) {
  return (
    <section
      className="compose-paper-section"
      data-editing={editing}
      data-preview-section={section.id}
      data-layout={section.layout}
    >
      <header>
        <h2>
          <button type="button" onClick={onEdit} aria-label={`Edit ${section.title}`}>
            {section.title}
          </button>
        </h2>
        {editing && <Badge tone="accent">Editing</Badge>}
      </header>
      {section.kind === 'divider' ? (
        <hr />
      ) : section.kind === 'note' ? (
        <div
          className="compose-note-preview"
          dangerouslySetInnerHTML={{ __html: section.noteHtml ?? '' }}
        />
      ) : (
        <>
          {section.depth === 'brief' && (
            <p className="compose-brief-gate">
              <Badge tone="locked">Set up AI</Badge>
              <a href="/settings/runs#setup-ai">Configure Briefs</a>
            </p>
          )}
          <div className={`compose-paper-items compose-paper-items--${section.layout}`}>
            {section.items.map((item, index) => {
              const lead = section.layout === 'lead' && index === 0;
              return (
                <article
                  key={item.id}
                  className={lead ? 'compose-preview-lead' : 'compose-preview-story'}
                >
                  {lead && section.images && item.imageUrl && (
                    <div className="compose-preview-hero">
                      <img
                        src={sourceImage(item.imageUrl)}
                        alt=""
                        data-static={item.imageUrl.startsWith('/figma/')}
                      />
                    </div>
                  )}
                  {lead && (
                    <div className="compose-preview-source">
                      <Avatar
                        id={item.feedId ?? item.feedTitle}
                        initial={item.feedTitle.slice(0, 1)}
                      />
                      <span>
                        {item.feedTitle} · {item.readTimeMinutes} min
                      </span>
                    </div>
                  )}
                  <div className="compose-preview-story-copy">
                    <h3>{item.title}</h3>
                    {!lead && (
                      <p className="compose-preview-source">
                        {item.feedTitle} · {item.readTimeMinutes} min
                      </p>
                    )}
                    {section.depth !== 'title' && section.depth !== 'brief' && (
                      <div
                        className="compose-preview-excerpt"
                        dangerouslySetInnerHTML={{
                          __html:
                            section.depth === 'full'
                              ? (item.contentHtml ?? item.summaryHtml ?? '')
                              : (item.summaryHtml ?? ''),
                        }}
                      />
                    )}
                  </div>
                  {!lead && section.images && section.layout !== 'headlines' && item.imageUrl && (
                    <div className="compose-preview-thumbnail">
                      <img
                        src={sourceImage(item.imageUrl)}
                        alt=""
                        data-static={item.imageUrl.startsWith('/figma/')}
                      />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          {!section.items.length && (
            <p className="compose-preview-empty">No matching stories for this issue.</p>
          )}
        </>
      )}
    </section>
  );
}
