import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  NewsletterLetter,
  NewsletterOverview,
  NewsletterSettingsPatch,
} from '@brew/core/types/newsletters';
import { updateArticleState } from '../articleState';
import { Avatar, Button, Chip, Toggle } from '../components/controls';
import { Icon } from '../components/Icon';
import { LetterTagsDialog } from './Dialogs';
import { letterDate, senderInitial } from './dates';

export function LetterPane({
  letter,
  overview,
  explicitOpen,
  pending,
  saveSender,
  settings,
}: {
  letter: NewsletterLetter;
  overview: NewsletterOverview;
  explicitOpen: boolean;
  pending: boolean;
  saveSender: (patch: NewsletterSettingsPatch) => Promise<void>;
  settings: () => void;
}) {
  const client = useQueryClient();
  const opened = useRef(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [failedState, setFailedState] = useState<{ read?: boolean; starred?: boolean } | null>(
    null,
  );
  const state = useMutation({
    mutationFn: (values: { read?: boolean; starred?: boolean }) =>
      updateArticleState(client, letter.id, values),
    onMutate: () => setFailedState(null),
    onError: (_error, values) => setFailedState(values),
  });
  const markRead = state.mutate;
  useEffect(() => {
    if (!explicitOpen || opened.current) return;
    opened.current = true;
    if (!letter.readAt) markRead({ read: true });
  }, [explicitOpen, letter.readAt, markRead]);
  const original = useQuery({
    queryKey: ['newsletter-original', letter.id],
    enabled: showOriginal && letter.originalAvailable,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/newsletters/letters/${letter.id}/original`, { signal });
      if (!response.ok)
        throw new Error(
          response.status === 404
            ? 'The original has expired or is unavailable.'
            : 'Could not load the original. Try again.',
        );
      return response.text();
    },
    staleTime: 0,
    gcTime: 0,
  });
  const sender = letter.sender;
  const originalHref = /^https?:\/\//i.test(letter.url)
    ? letter.url
    : letter.originalAvailable
      ? `/api/newsletters/letters/${letter.id}/original`
      : null;
  const displayingOriginal = showOriginal && letter.originalAvailable;
  const selectedBrew = overview.brews.find((brew) => brew.id === sender.settings.brewId);
  const pieces: string[] = [];
  if (letter.cleaning?.trackers)
    pieces.push(`${letter.cleaning.trackers} tracker${letter.cleaning.trackers === 1 ? '' : 's'}`);
  if (letter.cleaning?.sponsorBlocks)
    pieces.push(
      letter.cleaning.sponsorBlocks === 1
        ? 'a sponsor block'
        : `${letter.cleaning.sponsorBlocks} sponsor blocks`,
    );
  if (letter.cleaning?.footerTrimmed) pieces.push('the footer');
  const summary = pieces.length
    ? `Removed ${pieces.length === 1 ? pieces[0] : `${pieces.slice(0, -1).join(', ')} and ${pieces.at(-1)}`}`
    : 'Checked for trackers and mail chrome';
  const persist = (patch: NewsletterSettingsPatch) => {
    void saveSender(patch).catch(() => undefined);
  };
  return (
    <section
      className="letters-letter"
      aria-label={`Letter from ${sender.title}`}
      tabIndex={0}
      aria-keyshortcuts="m"
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (
          event.key.toLowerCase() !== 'm' ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          target.closest('input,textarea,select,dialog,[contenteditable="true"]') ||
          state.isPending
        )
          return;
        event.preventDefault();
        state.mutate({ read: !letter.readAt });
      }}
    >
      <div className="letters-toolbar" role="toolbar" aria-label="Letter actions">
        <Button
          variant="ghost"
          size="sm"
          icon={<Icon name="star" size={14} />}
          aria-pressed={sender.settings.favorite}
          disabled={pending}
          onClick={() => persist({ favorite: !sender.settings.favorite })}
        >
          Favorite
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Icon name="tag" size={14} />}
          onClick={() => setTagsOpen(true)}
        >
          Tag
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Icon name="download" size={14} />}
          aria-pressed={!!letter.starredAt}
          disabled={state.isPending}
          onClick={() => state.mutate({ starred: !letter.starredAt })}
        >
          {letter.starredAt ? 'Saved to Starred' : 'Save to Starred'}
        </Button>
        <span className="letters-spacer" />
        <Button
          variant="ghost"
          size="sm"
          icon={<Icon name="eye" size={14} />}
          aria-pressed={sender.settings.skipInbox}
          disabled={pending}
          onClick={() => persist({ skipInbox: !sender.settings.skipInbox })}
        >
          {sender.settings.skipInbox ? 'Unskip sender' : 'Skip sender'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Icon name="x" size={14} />}
          aria-pressed={sender.settings.blocked}
          disabled={pending}
          onClick={() => persist({ blocked: !sender.settings.blocked })}
        >
          {sender.settings.blocked ? 'Unblock' : 'Block'}
        </Button>
        {originalHref ? (
          <a
            className="brew-icon-button"
            href={originalHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open original"
          >
            <Icon name="external" size={15} />
          </a>
        ) : (
          <button
            className="brew-icon-button"
            disabled
            aria-label="Open original"
            title="Original expired with sender retention"
          >
            <Icon name="external" size={15} />
          </button>
        )}
      </div>
      <div className="letters-sender-settings">
        <button
          className="letters-sender-title"
          disabled={pending}
          onClick={settings}
          aria-label={`Settings for ${sender.title}`}
        >
          {sender.title}
        </button>
        <span>goes to</span>
        <button
          className="letters-chip-button"
          disabled={pending}
          onClick={settings}
          aria-label="Change sender Brew"
        >
          <Chip icon={<Icon name="brew" size={14} />}>
            {selectedBrew?.name ?? (sender.settings.brewId ? 'Brew unavailable' : 'Choose Brew')}
          </Chip>
        </button>
        <span>· kept</span>
        <button
          className="letters-chip-button"
          disabled={pending}
          onClick={settings}
          aria-label="Change sender retention"
        >
          <Chip icon={<Icon name="clock" size={14} />}>{sender.settings.retentionDays} days</Chip>
        </button>
        <span className="letters-spacer" />
        <span title="Hide from Reader’s general lists; keep this sender in Brews and Newsletters.">
          <Toggle
            label="Only in Brew"
            checked={sender.settings.onlyInBrew}
            disabled={pending || !sender.settings.brewId}
            onCheckedChange={(onlyInBrew) => persist({ onlyInBrew })}
          />
        </span>
      </div>
      {failedState && (
        <p className="letters-action-error" role="alert">
          Could not update this letter.{' '}
          <button onClick={() => state.mutate(failedState)}>Retry letter update</button>
        </p>
      )}
      <div className="letters-reading">
        <div className="letters-cleaning">
          <Icon name="shield" size={14} />
          <span>{summary}</span>
          <button
            aria-pressed={displayingOriginal}
            disabled={!letter.originalAvailable}
            title={letter.originalAvailable ? undefined : 'Original expired with sender retention'}
            onClick={() => setShowOriginal(!showOriginal)}
          >
            {displayingOriginal ? 'Show cleaned' : 'Show original'}
          </button>
        </div>
        {!letter.originalAvailable && (
          <p className="letters-original-note">
            The original expired with this sender’s retention. The cleaned letter is still
            available.
          </p>
        )}
        <header className="letters-author">
          <Avatar id={sender.id} initial={senderInitial(sender.title)} size={32} />
          <div>
            <strong>{sender.title}</strong>
            <button
              className="letters-read-state"
              aria-label={letter.readAt ? 'Mark letter unread' : 'Mark letter read'}
              title="Toggle read state (M)"
              disabled={state.isPending}
              onClick={() => state.mutate({ read: !letter.readAt })}
            >
              {sender.address} · {letterDate(letter.publishedAt, true)} · {letter.readTimeMinutes}{' '}
              min
            </button>
          </div>
        </header>
        <h2>{letter.title}</h2>
        {!!letter.tags.length && (
          <div className="letters-tags" aria-label="Letter tags">
            {letter.tags.map((tag) => (
              <Chip key={tag.id} icon={<Icon name="tag" size={12} />}>
                {tag.name}
              </Chip>
            ))}
          </div>
        )}
        {displayingOriginal ? (
          <div className="letters-original">
            <p className="letters-original-note">
              Original content. External images, links and active content are disabled.
            </p>
            {original.isPending ? (
              <p role="status">Loading original…</p>
            ) : original.isError ? (
              <p role="alert">
                {original.error.message}{' '}
                <button onClick={() => void original.refetch()}>Retry original</button>
              </p>
            ) : (
              <iframe
                title={`Original letter from ${sender.title}`}
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={original.data}
              />
            )}
          </div>
        ) : (
          <div
            className="letters-html"
            dangerouslySetInnerHTML={{
              __html:
                letter.fullTextHtml ??
                letter.contentHtml ??
                letter.summaryHtml ??
                '<p>This letter has no readable body.</p>',
            }}
          />
        )}
      </div>
      {tagsOpen && <LetterTagsDialog letter={letter} close={() => setTagsOpen(false)} />}
    </section>
  );
}
