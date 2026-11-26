import type {
  NewsletterSender,
  NewsletterSettingsPatch,
  SenderSettingsPreview,
} from '@brew/core/types/newsletters';
import { Button } from '../components/controls';
import { Badge } from '../components/Badge';

export function SenderActions({
  sender,
  capable,
  pending,
  brewAvailable,
  save,
  settings,
  href,
}: {
  sender: NewsletterSender;
  capable: boolean;
  pending: boolean;
  brewAvailable: boolean;
  save: (patch: NewsletterSettingsPatch) => void;
  settings: () => void;
  href: string;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      <a className="brew-button brew-button--secondary brew-button--md" href={href}>
        Open sender letters
      </a>
      <Button variant="secondary" onClick={settings}>
        Sender settings
      </Button>
      <Button
        variant="secondary"
        disabled={pending || !capable}
        aria-pressed={sender.settings.favorite}
        onClick={() => save({ favorite: !sender.settings.favorite })}
      >
        {sender.settings.favorite ? 'Unfavorite sender' : 'Favorite sender'}
      </Button>
      <Button
        variant="secondary"
        disabled={pending || !capable}
        aria-pressed={sender.settings.skipInbox}
        onClick={() => save({ skipInbox: !sender.settings.skipInbox })}
      >
        {sender.settings.skipInbox ? 'Unskip sender' : 'Skip sender'}
      </Button>
      <Button
        variant="secondary"
        disabled={pending || !capable}
        aria-pressed={sender.settings.blocked}
        onClick={() => save({ blocked: !sender.settings.blocked })}
      >
        {sender.settings.blocked ? 'Unblock' : 'Block'}
      </Button>
      <Button
        variant="secondary"
        disabled={pending || !capable || (!sender.settings.onlyInBrew && !brewAvailable)}
        aria-pressed={sender.settings.onlyInBrew}
        onClick={() => save({ onlyInBrew: !sender.settings.onlyInBrew })}
      >
        Only in Brew
      </Button>
      {!brewAvailable && (
        <p className="text-sm text-soft">Choose a Brew in sender settings to use Only in Brew.</p>
      )}
      {!capable && (
        <p className="text-sm">
          <Badge tone="warning">Undo needs setup</Badge>{' '}
          <a href="/settings/runs#setup-agents">Set up sender actions</a>
        </p>
      )}
    </div>
  );
}
export function SenderChangeReview({ preview }: { preview: SenderSettingsPreview }) {
  return (
    <div className="mt-4 space-y-3">
      <ul aria-label="Sender setting changes" className="space-y-2">
        {preview.changes.map((change) => (
          <li key={change.label}>
            <strong>{change.label}:</strong> {change.before} → {change.after}
          </li>
        ))}
      </ul>
      {!preview.changes.length && <p>These settings are already current.</p>}
      {(preview.lettersRemoved > 0 || preview.originalsRemoved > 0) && (
        <p>
          {preview.lettersRemoved} unstarred and untagged{' '}
          {preview.lettersRemoved === 1 ? 'letter' : 'letters'} will be removed.{' '}
          {preview.originalsRemoved} saved{' '}
          {preview.originalsRemoved === 1 ? 'original' : 'originals'} will be cleared, including
          originals of retained starred or tagged letters.
        </p>
      )}
      {preview.blocksMail && (
        <p>
          New mail from this sender will be rejected while blocked. Undo cannot recover mail
          rejected during that time.
        </p>
      )}
    </div>
  );
}
