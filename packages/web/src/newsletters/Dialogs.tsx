import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ArticleDetail, TagSummary } from '@brew/core/types/api';
import type {
  NewsletterLetter,
  NewsletterOverview,
  NewsletterSender,
  NewsletterSettingsPatch,
} from '@brew/core/types/newsletters';
import { ModalSheet } from '../components/Sheet';
import { Badge } from '../components/Badge';
import { Button, Checkbox, Input } from '../components/controls';
import { Select } from '../components/patterns';
import { newsletterJson } from './api';

export function SenderSettingsDialog({
  sender,
  brews,
  save,
  close,
  capable = true,
  returnFocusRef,
  reviewing = false,
  cancelReview,
}: {
  sender: NewsletterSender;
  brews: NewsletterOverview['brews'];
  save: (patch: NewsletterSettingsPatch) => Promise<boolean>;
  close: () => void;
  capable?: boolean;
  returnFocusRef?: RefObject<HTMLElement>;
  reviewing?: boolean;
  cancelReview?: () => void;
}) {
  const [draft, setDraft] = useState({ ...sender.settings, brewId: sender.settings.brewId ?? 0 });
  const [initial] = useState(() => structuredClone(sender.settings));
  const [retention, setRetention] = useState(String(sender.settings.retentionDays));
  const formId = useId();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [sponsors, setSponsors] = useState(
    sender.settings.cleaning?.sponsorSelectors?.join('\n') ?? '',
  );
  const [footers, setFooters] = useState(
    sender.settings.cleaning?.footerSelectors?.join('\n') ?? '',
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const cleaning = {
    sponsorSelectors: sponsors
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean),
    footerSelectors: footers
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean),
  };
  const candidate = { ...draft, brewId: draft.brewId || null, retentionDays: Number(retention) };
  const patch: NewsletterSettingsPatch = {};
  for (const key of [
    'favorite',
    'skipInbox',
    'blocked',
    'onlyInBrew',
    'brewId',
    'retentionDays',
  ] as const) {
    if ((candidate[key] ?? null) !== (initial[key] ?? null))
      Object.assign(patch, { [key]: candidate[key] });
  }
  const initialCleaning = {
    sponsorSelectors: initial.cleaning?.sponsorSelectors?.map((value) => value.trim()) ?? [],
    footerSelectors: initial.cleaning?.footerSelectors?.map((value) => value.trim()) ?? [],
  };
  if (JSON.stringify(cleaning) !== JSON.stringify(initialCleaning)) patch.cleaning = cleaning;
  const valid =
    /^\d+$/.test(retention) &&
    Number.isSafeInteger(Number(retention)) &&
    Number(retention) >= 1 &&
    Number(retention) <= 3650;
  const disabled = pending || !capable;
  const submit = async () => {
    if (disabled || !valid || !Object.keys(patch).length) return;
    setPending(true);
    setError('');
    try {
      const saved = await save(patch);
      if (saved && alive.current) close();
    } catch (failure) {
      if (alive.current)
        setError(failure instanceof Error ? failure.message : 'Could not save sender.');
    } finally {
      if (alive.current) setPending(false);
    }
  };
  return (
    <ModalSheet
      open
      title={`Settings for ${sender.title}`}
      onClose={() => {
        if (reviewing) {
          cancelReview?.();
          close();
        } else if (!pending) close();
      }}
      description={sender.address}
      className="letters-dialog"
      returnFocusRef={returnFocusRef}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={pending && !reviewing}
            onClick={reviewing ? cancelReview : close}
          >
            {reviewing ? 'Cancel review' : 'Cancel'}
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={disabled || !valid || !Object.keys(patch).length}
            data-brew-action="save-sender"
          >
            {pending ? 'Saving…' : 'Save sender'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="letters-dialog-fields"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Select
          label="Goes to Brew"
          value={draft.brewId}
          disabled={disabled}
          onChange={(event) => {
            const brewId = Number(event.target.value);
            setDraft((current) => ({
              ...current,
              brewId,
              onlyInBrew: brewId ? current.onlyInBrew : false,
            }));
          }}
        >
          <option value={0}>No Brew</option>
          {draft.brewId > 0 && !brews.some((brew) => brew.id === draft.brewId) && (
            <option value={draft.brewId}>Brew unavailable</option>
          )}
          {brews.map((brew) => (
            <option key={brew.id} value={brew.id}>
              {brew.name}
            </option>
          ))}
        </Select>
        <Input
          label="Retention in days"
          type="number"
          min={1}
          max={3650}
          value={retention}
          required
          disabled={disabled}
          onChange={(event) => setRetention(event.target.value)}
        />
        <p>Expired originals are removed. Starred and tagged letters keep their cleaned text.</p>
        <Checkbox
          label="Favorite sender"
          checked={draft.favorite}
          disabled={disabled}
          onChange={(event) => setDraft({ ...draft, favorite: event.target.checked })}
        />
        <Checkbox
          label="Skip sender in Inbox"
          checked={draft.skipInbox}
          disabled={disabled}
          onChange={(event) => setDraft({ ...draft, skipInbox: event.target.checked })}
        />
        <Checkbox
          label="Block new mail from this sender"
          checked={draft.blocked}
          disabled={disabled}
          onChange={(event) => setDraft({ ...draft, blocked: event.target.checked })}
        />
        <Checkbox
          label="Only in Brew"
          checked={draft.onlyInBrew}
          disabled={
            disabled || (!draft.onlyInBrew && !brews.some((brew) => brew.id === draft.brewId))
          }
          onChange={(event) => setDraft({ ...draft, onlyInBrew: event.target.checked })}
        />
        <p>
          Only in Brew keeps this sender out of Reader’s general lists. You can still manage letters
          here, search, open the sender directly or save a letter to Starred.
        </p>
        <details>
          <summary>Cleaning overrides</summary>
          <p>One CSS selector per line. These apply to future letters.</p>
          <label htmlFor={`${formId}-sponsors`}>Sponsor selectors</label>
          <textarea
            id={`${formId}-sponsors`}
            value={sponsors}
            disabled={disabled}
            onChange={(event) => setSponsors(event.target.value)}
          />
          <label htmlFor={`${formId}-footers`}>Footer selectors</label>
          <textarea
            id={`${formId}-footers`}
            value={footers}
            disabled={disabled}
            onChange={(event) => setFooters(event.target.value)}
          />
        </details>
        {error && <p role="alert">{error}</p>}
        {!capable && (
          <p>
            <Badge tone="warning">Undo needs setup</Badge>{' '}
            <a href="/settings/runs#setup-agents">Set up sender actions</a>
          </p>
        )}
      </form>
    </ModalSheet>
  );
}

export function LetterTagsDialog({
  letter,
  close,
  returnFocusRef,
}: {
  letter: NewsletterLetter;
  close: () => void;
  returnFocusRef?: RefObject<HTMLElement>;
}) {
  const client = useQueryClient();
  const tags = useQuery({
    queryKey: ['tags'],
    queryFn: ({ signal }) => newsletterJson<TagSummary[]>('/api/tags', signal),
  });
  const [selected, setSelected] = useState(letter.tags.map((tag) => tag.id));
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setPending(true);
    setError('');
    try {
      const ids = [...selected];
      if (name.trim()) {
        const tag = await newsletterJson<TagSummary>('/api/tags', undefined, {
          method: 'POST',
          body: JSON.stringify({ name: name.trim() }),
        });
        if (!ids.includes(tag.id)) ids.push(tag.id);
        setSelected(ids);
        setName('');
        void client.invalidateQueries({ queryKey: ['tags'] });
      }
      const saved = await newsletterJson<ArticleDetail>(
        `/api/articles/${letter.id}/tags`,
        undefined,
        { method: 'PUT', body: JSON.stringify({ tagIds: ids }) },
      );
      for (const key of ['article', 'newsletter-letter'])
        client.setQueryData<ArticleDetail>([key, letter.id], (current) =>
          current ? { ...current, tags: saved.tags } : current,
        );
      void client.invalidateQueries({ queryKey: ['newsletter-overview'] });
      close();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save tags.');
    } finally {
      setPending(false);
    }
  };
  return (
    <ModalSheet
      open
      title="Tag this letter"
      returnFocusRef={returnFocusRef}
      onClose={() => {
        if (!pending) close();
      }}
      className="letters-dialog"
      footer={
        <>
          <Button variant="secondary" disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={pending || tags.isPending || tags.isError}
            onClick={() => void submit()}
          >
            {pending ? 'Saving…' : 'Save tags'}
          </Button>
        </>
      }
    >
      <div className="letters-dialog-fields">
        {tags.isPending && <p role="status">Loading tags…</p>}
        {tags.isError && (
          <p role="alert">
            Could not load tags. <button onClick={() => void tags.refetch()}>Retry tags</button>
          </p>
        )}
        {tags.data?.map((tag) => (
          <Checkbox
            key={tag.id}
            label={tag.name}
            checked={selected.includes(tag.id)}
            disabled={pending}
            onChange={(event) =>
              setSelected(
                event.target.checked
                  ? [...selected, tag.id]
                  : selected.filter((id) => id !== tag.id),
              )
            }
          />
        ))}
        <Input
          label="New tag"
          value={name}
          disabled={pending}
          onChange={(event) => setName(event.target.value)}
        />
        {error && <p role="alert">{error}</p>}
      </div>
    </ModalSheet>
  );
}

export function GmailForwardingDialog({
  address,
  close,
}: {
  address: string | null;
  close: () => void;
}) {
  return (
    <ModalSheet
      open
      title="Forward from Gmail"
      onClose={close}
      className="letters-dialog"
      footer={<Button onClick={close}>Done</Button>}
    >
      <div className="letters-dialog-fields">
        {!address ? (
          <p>
            Connect mail first to get your receiving address.{' '}
            <a href="/settings/runs#setup-newsletters">Set up mail</a>
          </p>
        ) : (
          <p>
            Your receiving address: <code>{address}</code>
          </p>
        )}
        <ol className="letters-gmail-steps">
          <li>
            In Gmail on your computer, open Settings → See all settings → Forwarding and POP/IMAP
            (or Forwarding). Add your Brew address.
          </li>
          <li>
            Find Gmail’s verification email in Brew or your dedicated mailbox. Open its confirmation
            link from the cleaned letter, then return to Gmail.
          </li>
          <li>
            Leave forwarding for all mail off. In Gmail’s search options, choose the newsletter
            sender or another narrow match, then create a filter.
          </li>
          <li>
            Choose “Forward it to”, select your verified Brew address and save the filter. It
            applies to new matching messages; older mail is not forwarded by the filter.
          </li>
        </ol>
        <p>This uses Gmail’s forwarding filters. Brew does not connect to your Google account.</p>
        <p>
          <a
            href="https://support.google.com/mail/answer/10957?hl=en"
            target="_blank"
            rel="noopener noreferrer"
          >
            Gmail forwarding instructions
          </a>{' '}
          ·{' '}
          <a
            href="https://support.google.com/mail/answer/6579?hl=en"
            target="_blank"
            rel="noopener noreferrer"
          >
            Gmail filter instructions
          </a>
        </p>
      </div>
    </ModalSheet>
  );
}
