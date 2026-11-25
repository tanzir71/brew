import { useQuery } from '@tanstack/react-query';
import type { Capabilities } from '@brew/core/types/capabilities';
import type { TagSummary } from '@brew/core/types/api';
import type { BrewSourceRef } from '@brew/core/types/brew';
import type { NewsletterOverview } from '@brew/core/types/newsletters';
import { Avatar, Button, Checkbox } from '../components/controls';
import { Badge } from '../components/Badge';
import { composeJson } from './useComposeDraft';
import { senderInitial } from '../newsletters/dates';

export function NewsletterSources({
  source,
  tags,
  term,
  busy,
  inboundMail,
  onChange,
}: {
  source?: BrewSourceRef;
  tags: TagSummary[];
  term: string;
  busy: boolean;
  inboundMail: Capabilities['inboundMail'];
  onChange: (source?: BrewSourceRef) => void;
}) {
  const overview = useQuery({
    queryKey: ['newsletter-overview'],
    retry: false,
    queryFn: ({ signal }) =>
      composeJson<NewsletterOverview>('/api/newsletters/overview', { signal }),
  });
  const choose = (field: 'senderIds' | 'tagIds', id: number, checked: boolean) => {
    const senderIds = [...(source?.senderIds ?? [])];
    const tagIds = [...(source?.tagIds ?? [])];
    const ids = field === 'senderIds' ? senderIds : tagIds;
    const index = ids.indexOf(id);
    if (checked && index === -1) ids.push(id);
    if (!checked && index !== -1) ids.splice(index, 1);
    onChange(
      senderIds.length || tagIds.length
        ? {
            kind: 'newsletters',
            ...(senderIds.length ? { senderIds } : {}),
            ...(tagIds.length ? { tagIds } : {}),
          }
        : undefined,
    );
  };
  if (overview.isPending)
    return (
      <p className="source-empty" role="status">
        Loading newsletter senders…
      </p>
    );
  if (overview.isError)
    return (
      <div className="source-error" role="alert">
        Could not load newsletter senders.{' '}
        <Button size="sm" variant="secondary" onClick={() => void overview.refetch()}>
          Retry newsletter senders
        </Button>
      </div>
    );
  const senders = overview.data.senders;
  const ready = !!inboundMail || senders.length > 0;
  const matches = (value: string) =>
    term.split(/\s+/).every((word) => value.toLocaleLowerCase().includes(word));
  const visibleSenders = senders.filter((sender) => matches(`${sender.title} ${sender.address}`));
  const visibleTags = tags.filter((tag) => matches(tag.name));
  const missingSenders =
    source?.senderIds?.filter((id) => !senders.some((sender) => sender.id === id)) ?? [];
  const missingTags = source?.tagIds?.filter((id) => !tags.some((tag) => tag.id === id)) ?? [];
  return (
    <div className="source-newsletter-library" role="group" aria-label="Newsletter selection">
      <div className="source-row">
        <Checkbox
          label="All newsletter senders"
          checked={!!source && !source.senderIds && !source.tagIds}
          disabled={busy || (!ready && !source)}
          onChange={(event) => onChange(event.target.checked ? { kind: 'newsletters' } : undefined)}
        />
      </div>
      <p>
        All senders includes future senders. Or choose letters from any selected sender or tag. Tags
        only match newsletter letters.
      </p>
      {!inboundMail && (
        <div className="source-empty">
          <Badge tone="warning">Needs mail add-on</Badge>
          <a href="/settings/runs#setup-newsletters">Set up Newsletters</a>
        </div>
      )}
      <fieldset>
        <legend>Senders</legend>
        {visibleSenders.map((sender) => (
          <div className="source-row" key={sender.id}>
            <Checkbox
              aria-label={`Sender: ${sender.title}`}
              checked={source?.senderIds?.includes(sender.id) ?? false}
              disabled={busy}
              onChange={(event) => choose('senderIds', sender.id, event.target.checked)}
              label={
                <>
                  <Avatar id={sender.id} initial={senderInitial(sender.title)} />
                  <span className="source-row-title">{sender.title}</span>
                  <small className="source-row-caption">
                    {sender.letterCount} {sender.letterCount === 1 ? 'letter' : 'letters'}
                  </small>
                  {sender.settings.blocked ? (
                    <Badge tone="neutral">Blocked</Badge>
                  ) : sender.settings.skipInbox ? (
                    <Badge tone="neutral">Skipped Inbox</Badge>
                  ) : null}
                </>
              }
            />
          </div>
        ))}
        {!visibleSenders.length && (
          <p className="source-empty">
            {senders.length ? 'No senders match this filter.' : 'No newsletter senders yet.'}
          </p>
        )}
        {missingSenders.map((id) => (
          <div className="source-row" key={id}>
            <Checkbox
              label={`Unavailable sender ${id}`}
              checked
              disabled={busy}
              onChange={() => choose('senderIds', id, false)}
            />
          </div>
        ))}
      </fieldset>
      <fieldset>
        <legend>Tags on letters</legend>
        {visibleTags.map((tag) => (
          <div className="source-row" key={tag.id}>
            <Checkbox
              label={tag.name}
              aria-label={`Newsletter tag: ${tag.name}`}
              checked={source?.tagIds?.includes(tag.id) ?? false}
              disabled={busy || (!ready && !source?.tagIds?.includes(tag.id))}
              onChange={(event) => choose('tagIds', tag.id, event.target.checked)}
            />
          </div>
        ))}
        {!visibleTags.length && (
          <p className="source-empty">
            {tags.length
              ? 'No tags match this filter.'
              : 'Tag a letter in Newsletters to organize it here.'}
          </p>
        )}
        {missingTags.map((id) => (
          <div className="source-row" key={id}>
            <Checkbox
              label={`Unavailable newsletter tag ${id}`}
              checked
              disabled={busy}
              onChange={() => choose('tagIds', id, false)}
            />
          </div>
        ))}
      </fieldset>
      <p>
        Retained letters remain available here, including skipped senders. Blocking stops new mail.{' '}
        <a href="/letters">Manage Newsletters</a>
      </p>
    </div>
  );
}
