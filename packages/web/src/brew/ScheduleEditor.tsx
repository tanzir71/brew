import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { BrewConfigDraft, BrewSchedule } from '@brew/core/types/brew';
import type { ScheduleInfo } from '@brew/core/types/delivery';
import { BREW_RETENTION_DAYS, validateComposition } from '@brew/core/composition-model';
import { SideSheet } from '../components/Sheet';
import { Badge } from '../components/Badge';
import { Button, Input, SegmentedControl, Toggle } from '../components/controls';
import { Select, Stepper } from '../components/patterns';
import { Icon, type IconName } from '../components/Icon';
import { useCapabilities } from '../hooks/useCapabilities';
import { composeJson } from './useComposeDraft';

export type ScheduleSettings = Pick<
  BrewConfigDraft,
  'schedule' | 'timezone' | 'enabled' | 'delivery'
>;
const times = Array.from(
  { length: 1440 },
  (_, minute) =>
    `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`,
);
const zones =
  typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : ['Asia/Dhaka', 'America/New_York', 'Europe/London', 'Asia/Tokyo'];
const weekdays = [
  { id: 1, label: 'Monday', initial: 'M' },
  { id: 2, label: 'Tuesday', initial: 'T' },
  { id: 3, label: 'Wednesday', initial: 'W' },
  { id: 4, label: 'Thursday', initial: 'T' },
  { id: 5, label: 'Friday', initial: 'F' },
  { id: 6, label: 'Saturday', initial: 'S' },
  { id: 0, label: 'Sunday', initial: 'S' },
];
const selectedDays = (schedule: BrewSchedule) =>
  schedule.kind === 'daily'
    ? [0, 1, 2, 3, 4, 5, 6]
    : schedule.kind === 'weekdays'
      ? [1, 2, 3, 4, 5]
      : (schedule.days ?? []);
function offset(timezone: string, at?: string) {
  try {
    return (
      new Intl.DateTimeFormat('en', { timeZone: timezone, timeZoneName: 'shortOffset' })
        .formatToParts(new Date(at ?? Date.now()))
        .find((part) => part.type === 'timeZoneName')
        ?.value.replace('GMT', 'UTC') ?? ''
    );
  } catch {
    return '';
  }
}

export function ScheduleEditor({
  id,
  draft,
  onApply,
  onClose,
  saveError = '',
}: {
  id: number;
  draft: BrewConfigDraft;
  onApply: (value: ScheduleSettings) => Promise<boolean>;
  onClose: () => void;
  saveError?: string;
}) {
  const [value, setValue] = useState<ScheduleSettings>(() => ({
    schedule: draft.schedule,
    timezone: draft.timezone,
    enabled: draft.enabled,
    delivery: draft.delivery,
  }));
  const [skipSize, setSkipSize] = useState(draft.schedule.skipIfFewerThan || 5);
  const [emailTo, setEmailTo] = useState(draft.delivery.email?.to ?? '');
  const [webhookUrl, setWebhookUrl] = useState(draft.delivery.webhook?.url ?? '');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [info, setInfo] = useState<{ key: string; data: ScheduleInfo } | null>(null);
  const [infoError, setInfoError] = useState<{ key: string; message: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const firstRef = useRef<HTMLButtonElement | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const caps = useCapabilities();
  const scheduling = { schedule: value.schedule, timezone: value.timezone, enabled: value.enabled };
  const infoKey = JSON.stringify(scheduling);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () =>
        void composeJson<ScheduleInfo>(`/api/brew-configs/${id}/schedule-preview`, {
          method: 'POST',
          signal: controller.signal,
          body: infoKey,
        })
          .then((data) => {
            if (!controller.signal.aborted) {
              setInfo({ key: infoKey, data });
              setInfoError(null);
            }
          })
          .catch((failure: Error) => {
            if (!controller.signal.aborted)
              setInfoError({ key: infoKey, message: failure.message });
          }),
      150,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [id, infoKey, retry]);
  const currentInfo = info?.key === infoKey ? info.data : null;
  const scheduleError = infoError?.key === infoKey ? infoError.message : '';
  const update = (partial: Partial<ScheduleSettings>) => {
    setValue((current) => ({ ...current, ...partial }));
    setError('');
    setMessage('');
  };
  const updateSchedule = (partial: Partial<BrewSchedule>) => {
    setValue((current) => ({ ...current, schedule: { ...current.schedule, ...partial } }));
    setError('');
    setMessage('');
  };
  const delivery = (partial: Partial<ScheduleSettings['delivery']>) => {
    setValue((current) => ({ ...current, delivery: { ...current.delivery, ...partial } }));
    setError('');
    setMessage('');
  };
  const fullDraft = (): BrewConfigDraft => ({ ...draft, ...value });
  const save = async () => {
    setError('');
    setMessage('');
    try {
      validateComposition(fullDraft());
      setBusy('save');
      if (await onApply(value)) onClose();
      else if (alive.current) setError('Could not save these settings. Try Save again.');
    } catch (failure) {
      if (alive.current) setError((failure as Error).message);
    } finally {
      if (alive.current) setBusy(null);
    }
  };
  const sendTest = async () => {
    setError('');
    setMessage('');
    try {
      const preview = fullDraft();
      validateComposition(preview);
      if (!preview.delivery.email)
        throw new Error('Enable Email and choose a recipient for the test.');
      setBusy('test');
      const result = await composeJson<{ sent: boolean; to: string }>(
        `/api/brew-configs/${id}/test-email`,
        { method: 'POST', body: JSON.stringify({ draft: preview }) },
      );
      if (!result.sent) throw new Error('The mail service did not confirm the test.');
      if (alive.current) setMessage(`Test sent to ${result.to}.`);
    } catch (failure) {
      if (alive.current) setError((failure as Error).message);
    } finally {
      if (alive.current) setBusy(null);
    }
  };
  const days = selectedDays(value.schedule);
  const skipEnabled = (value.schedule.skipIfFewerThan ?? 0) > 0;
  const feedReady = !!caps.data?.outputs?.feed;
  const webhookReady = !!caps.data?.outputs?.webhook;
  const mailReady = !!caps.data?.emailDelivery;
  const publicReady = !!caps.data?.publicCopy;
  const emailChecked = !!value.delivery.email;
  return (
    <SideSheet
      open
      className="schedule-sheet"
      title="Schedule & delivery"
      description={`When ${draft.name} is made, and where it goes.`}
      initialFocusRef={firstRef}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <div className="schedule-footer">
          {(error || saveError) && (
            <p className="schedule-error" role="alert">
              {saveError || error}
            </p>
          )}
          {message && (
            <p className="schedule-message" role="status">
              {message}
            </p>
          )}
          <div className="schedule-footer-actions">
            <Button
              variant="secondary"
              icon={<Icon name="send" size={16} />}
              disabled={!!busy || !mailReady || !emailChecked || !emailTo}
              onClick={() => void sendTest()}
            >
              {busy === 'test' ? 'Sending test…' : 'Send a test now'}
            </Button>
            <span className="brew-spacer" />
            <Button disabled={!!busy} onClick={() => void save()}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      }
    >
      <fieldset className="schedule-fields" disabled={!!busy}>
        <section className="schedule-repeat" aria-label="Repeat schedule">
          <div className="schedule-heading">
            <h3>Repeat</h3>
            <Toggle
              label="Scheduled"
              checked={value.enabled}
              onCheckedChange={(enabled) => update({ enabled })}
            />
          </div>
          <div
            ref={(element) => {
              if (element)
                firstRef.current = element.querySelector<HTMLButtonElement>('[aria-checked=true]');
            }}
          >
            <SegmentedControl
              label="Repeat"
              value={value.schedule.kind}
              options={[
                { value: 'daily', label: 'Daily' },
                { value: 'weekdays', label: 'Weekdays' },
                { value: 'weekly', label: 'Weekly' },
                { value: 'monthly', label: 'Monthly' },
              ]}
              onValueChange={(kind) =>
                updateSchedule({
                  kind: kind as BrewSchedule['kind'],
                  ...(kind === 'weekly' ? { days: [...days] } : {}),
                  ...(kind === 'monthly' ? { dayOfMonth: value.schedule.dayOfMonth ?? 1 } : {}),
                })
              }
            />
          </div>
          {value.schedule.kind === 'monthly' ? (
            <div className="schedule-month">
              <Input
                label="Day of month"
                type="number"
                min={1}
                max={31}
                step={1}
                value={Number.isFinite(value.schedule.dayOfMonth) ? value.schedule.dayOfMonth : ''}
                onChange={(event) => updateSchedule({ dayOfMonth: event.target.valueAsNumber })}
              />
              <p>Months without this date are skipped.</p>
            </div>
          ) : (
            <div className="schedule-days" role="group" aria-label="Days of the week">
              {weekdays.map((day) => (
                <button
                  type="button"
                  key={day.id}
                  aria-label={day.label}
                  aria-pressed={days.includes(day.id)}
                  onClick={() =>
                    updateSchedule({
                      kind: 'weekly',
                      days: days.includes(day.id)
                        ? days.filter((id) => id !== day.id)
                        : [...days, day.id].sort((a, b) => a - b),
                    })
                  }
                >
                  {day.initial}
                </button>
              ))}
            </div>
          )}
        </section>
        <div className="schedule-time-row">
          <Select
            label="Time"
            value={value.schedule.time}
            onChange={(event) => updateSchedule({ time: event.target.value })}
          >
            {times.map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </Select>
          <Select
            label="Time zone"
            value={value.timezone}
            onChange={(event) => update({ timezone: event.target.value })}
          >
            {[...new Set(['UTC', value.timezone, ...zones])].sort().map((zone) => (
              <option key={zone} value={zone}>
                {zone}
                {zone === value.timezone
                  ? ` (${offset(zone, currentInfo?.nextAt ?? currentInfo?.now)})`
                  : ''}
              </option>
            ))}
          </Select>
        </div>
        <div className="schedule-skip">
          <Toggle
            label="Skip small issues"
            hideLabel
            checked={skipEnabled}
            onCheckedChange={(checked) =>
              updateSchedule({ skipIfFewerThan: checked ? skipSize : 0 })
            }
          />
          <div>
            <span>Skip the issue when fewer than</span>
            <Stepper
              label="Skip threshold"
              min={1}
              max={Number.MAX_SAFE_INTEGER}
              disabled={!skipEnabled}
              value={skipSize}
              onValueChange={(next) => {
                setSkipSize(next);
                updateSchedule({ skipIfFewerThan: next });
              }}
            />
            <span>new items</span>
          </div>
        </div>
        <p className="schedule-next" role="status">
          {scheduleError ? (
            <>
              {scheduleError}{' '}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setInfoError(null);
                  setRetry((value) => value + 1);
                }}
              >
                Retry schedule
              </Button>
            </>
          ) : currentInfo ? (
            currentInfo.nextAt ? (
              `Next issue · ${new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: currentInfo.timezone }).format(new Date(currentInfo.nextAt))}`
            ) : (
              'Schedule paused'
            )
          ) : (
            'Checking next issue…'
          )}
        </p>
        <hr />
        <section className="schedule-delivery" aria-label="Delivery channels">
          <h3>Deliver to</h3>
          {caps.isError && (
            <p className="schedule-error" role="alert">
              Could not check delivery availability.{' '}
              <Button size="sm" variant="secondary" onClick={() => void caps.refetch()}>
                Retry delivery
              </Button>
            </p>
          )}
          <div className="schedule-channel-list">
            <DeliveryRow
              icon="browser"
              label="In Brew"
              description={`Always on. Each issue is kept for ${BREW_RETENTION_DAYS} days.`}
              badge={<Badge tone="positive">Works here</Badge>}
            />
            <DeliveryRow
              icon="rss"
              label="Atom and JSON feed"
              description={
                feedReady
                  ? `Read it in any feed reader: /b/${id}.atom`
                  : 'Preview the draft’s feed in Compose.'
              }
              checked={value.delivery.feed}
              available={feedReady}
              onChange={(feed) => delivery({ feed })}
              badge={!feedReady && <Badge tone="neutral">Preview only</Badge>}
              setup={!feedReady ? '/settings/runs#setup-outputs' : undefined}
            />
            <DeliveryRow
              icon="mail"
              label="Email"
              description={
                value.delivery.email?.to
                  ? `Send to ${value.delivery.email.to} as a clean HTML email.`
                  : 'Send a clean HTML email through your mail connection.'
              }
              checked={emailChecked}
              available={mailReady}
              onChange={(checked) => delivery({ email: checked ? { to: emailTo } : undefined })}
              badge={!mailReady && <Badge tone="warning">Needs mail add-on</Badge>}
              setup={!mailReady ? '/settings/runs#setup-delivery' : undefined}
            >
              {emailChecked && (
                <Input
                  label="Email recipient"
                  type="email"
                  value={emailTo}
                  disabled={!mailReady}
                  onChange={(event) => {
                    setEmailTo(event.target.value);
                    delivery({ email: { to: event.target.value } });
                  }}
                />
              )}
            </DeliveryRow>
            <DeliveryRow
              icon="link"
              label="Webhook"
              description="POST each issue as JSON to a URL you choose."
              checked={!!value.delivery.webhook}
              available={webhookReady}
              onChange={(checked) =>
                delivery({ webhook: checked ? { url: webhookUrl } : undefined })
              }
              badge={!webhookReady && <Badge tone="neutral">Needs setup</Badge>}
              setup={!webhookReady ? '/settings/runs#setup-outputs' : undefined}
            >
              {value.delivery.webhook && (
                <Input
                  label="Webhook URL"
                  type="url"
                  value={webhookUrl}
                  disabled={!webhookReady}
                  onChange={(event) => {
                    setWebhookUrl(event.target.value);
                    delivery({ webhook: { url: event.target.value } });
                  }}
                />
              )}
            </DeliveryRow>
            <DeliveryRow
              icon="globe"
              label="Public page"
              description="Publish a read-only copy to GitHub Pages."
              checked={value.delivery.publicCopy}
              available={publicReady}
              onChange={(publicCopy) => delivery({ publicCopy })}
              badge={<Badge tone="neutral">Read-only</Badge>}
              setup={!publicReady ? '/settings/runs#setup-data' : undefined}
            />
          </div>
        </section>
      </fieldset>
    </SideSheet>
  );
}
function DeliveryRow({
  icon,
  label,
  description,
  badge,
  checked,
  available,
  onChange,
  setup,
  children,
}: {
  icon: IconName;
  label: string;
  description: string;
  badge?: ReactNode;
  checked?: boolean;
  available?: boolean;
  onChange?: (checked: boolean) => void;
  setup?: string;
  children?: ReactNode;
}) {
  return (
    <div className="schedule-channel">
      <Icon name={icon} size={18} />
      <div className="schedule-channel-content">
        <header>
          <h4>{label}</h4>
          {onChange && badge}
        </header>
        <p>{description}</p>
        {children}
        {setup && (
          <p className="schedule-setup">
            <a href={setup}>Set up</a>
            {checked && onChange && (
              <button
                type="button"
                onClick={() => onChange(false)}
                aria-label={`Disable ${label} preference`}
              >
                Remove preference
              </button>
            )}
          </p>
        )}
      </div>
      {!onChange && badge}
      {onChange && (
        <Toggle
          label={label}
          hideLabel
          checked={!!checked}
          disabled={!available}
          onCheckedChange={onChange}
        />
      )}
    </div>
  );
}
