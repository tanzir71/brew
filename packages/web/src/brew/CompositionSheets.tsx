import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ReaderNavigation, TagSummary } from '@brew/core/types/api';
import type { BrewConfigDraft, BrewSection, BrewSourceRef } from '@brew/core/types/brew';
import { validateComposition } from '@brew/core/composition-model';
import { ModalSheet } from '../components/Sheet';
import { Button, Checkbox, Input } from '../components/controls';
import { Badge } from '../components/Badge';
import { useCapabilities } from '../hooks/useCapabilities';
import { composeJson } from './useComposeDraft';

const key = (source: BrewSourceRef) => `${source.kind}:${source.id ?? ''}`;
export function SourcePicker({
  section,
  onApply,
  onClose,
}: {
  section: BrewSection;
  onApply: (sources: BrewSourceRef[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(section.sources);
  const nav = useQuery({
    queryKey: ['reader-navigation'],
    queryFn: () => composeJson<ReaderNavigation>('/api/reader/navigation'),
  });
  const tags = useQuery({
    queryKey: ['tags'],
    queryFn: () => composeJson<TagSummary[]>('/api/tags'),
  });
  const caps = useCapabilities();
  const choices: Array<{ label: string; source: BrewSourceRef }> = [
    { label: 'Today — all articles', source: { kind: 'today' } },
    { label: 'Starred', source: { kind: 'starred' } },
    { label: 'Featured by rules', source: { kind: 'featured' } },
    { label: 'Weekly review', source: { kind: 'weekly_review' } },
    ...(nav.data?.folders.map((folder) => ({
      label: `Folder · ${folder.title}`,
      source: { kind: 'folder' as const, id: folder.id },
    })) ?? []),
    ...[
      ...(nav.data?.folders.flatMap((folder) => folder.feeds) ?? []),
      ...(nav.data?.unfiled ?? []),
    ].map((feed) => ({
      label: `Feed · ${feed.title}`,
      source: { kind: 'feed' as const, id: feed.id },
    })),
    ...(tags.data?.map((tag) => ({
      label: `Tag · ${tag.name}`,
      source: { kind: 'tag' as const, id: tag.id },
    })) ?? []),
  ];
  for (const source of section.sources)
    if (!choices.some((choice) => key(choice.source) === key(source)))
      choices.push({ label: `${source.kind} ${source.id ?? ''}`, source });
  return (
    <ModalSheet
      open
      title={`Sources · ${section.title}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!selected.length} onClick={() => onApply(selected)}>
            Use {selected.length} {selected.length === 1 ? 'source' : 'sources'}
          </Button>
        </>
      }
    >
      <div className="compose-source-choices">
        {(nav.isError || tags.isError) && (
          <p role="alert">
            Some library sources could not load.{' '}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void nav.refetch();
                void tags.refetch();
              }}
            >
              Retry sources
            </Button>
          </p>
        )}
        {choices.map((choice) => (
          <Checkbox
            key={key(choice.source)}
            label={
              ['newsletters', 'saved_search'].includes(choice.source.kind)
                ? `${choice.label} · needs setup`
                : choice.label
            }
            disabled={
              ['newsletters', 'saved_search'].includes(choice.source.kind) &&
              !selected.some((source) => key(source) === key(choice.source))
            }
            checked={selected.some((source) => key(source) === key(choice.source))}
            onChange={(event) =>
              setSelected((current) =>
                event.target.checked
                  ? [...current, choice.source]
                  : current.filter((source) => key(source) !== key(choice.source)),
              )
            }
          />
        ))}
        <div className="compose-gate">
          <Checkbox label="Newsletters" checked={false} disabled readOnly />
          <Badge tone={caps.data?.inboundMail ? 'neutral' : 'warning'}>
            {caps.data?.inboundMail ? 'Not available yet' : 'Needs mail add-on'}
          </Badge>
          <a href="/settings/runs#setup-newsletters">Set up</a>
        </div>
        <div className="compose-gate">
          <Checkbox label="Saved searches" checked={false} disabled readOnly />
          <Badge tone="locked">Not available yet</Badge>
        </div>
      </div>
    </ModalSheet>
  );
}
export function ScheduleEditor({
  draft,
  onApply,
  onClose,
}: {
  draft: BrewConfigDraft;
  onApply: (value: BrewConfigDraft) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(draft);
  const [error, setError] = useState('');
  const update = (partial: Partial<BrewConfigDraft['schedule']>) =>
    setValue((current) => ({ ...current, schedule: { ...current.schedule, ...partial } }));
  return (
    <ModalSheet
      open
      title="Schedule & delivery"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              try {
                validateComposition(value);
                onApply(value);
              } catch (failure) {
                setError((failure as Error).message);
              }
            }}
          >
            Save schedule
          </Button>
        </>
      }
    >
      <div className="compose-schedule-fields">
        <label>
          Frequency
          <select
            value={value.schedule.kind}
            onChange={(event) =>
              update({
                kind: event.target.value as BrewConfigDraft['schedule']['kind'],
                days: [1],
                dayOfMonth: 1,
              })
            }
          >
            <option value="daily">Daily</option>
            <option value="weekdays">Weekdays</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        {value.schedule.kind === 'weekly' && (
          <fieldset>
            <legend>Days</legend>
            <div className="compose-day-choices">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => (
                <Button
                  key={day}
                  size="sm"
                  variant={value.schedule.days?.includes(index) ? 'primary' : 'secondary'}
                  aria-pressed={value.schedule.days?.includes(index) ?? false}
                  onClick={() =>
                    update({
                      days: value.schedule.days?.includes(index)
                        ? value.schedule.days.filter((item) => item !== index)
                        : [...(value.schedule.days ?? []), index],
                    })
                  }
                >
                  {day}
                </Button>
              ))}
            </div>
          </fieldset>
        )}
        {value.schedule.kind === 'monthly' && (
          <Input
            label="Day of month"
            type="number"
            min={1}
            max={31}
            value={value.schedule.dayOfMonth ?? 1}
            onChange={(event) => update({ dayOfMonth: event.currentTarget.valueAsNumber })}
          />
        )}
        <Input
          label="Time"
          type="time"
          value={value.schedule.time}
          onChange={(event) => update({ time: event.target.value })}
        />
        <Input
          label="IANA time zone"
          value={value.timezone}
          onChange={(event) =>
            setValue((current) => ({ ...current, timezone: event.target.value }))
          }
        />
        <Input
          label="Skip if fewer than"
          type="number"
          min={0}
          value={value.schedule.skipIfFewerThan ?? 0}
          onChange={(event) => update({ skipIfFewerThan: event.currentTarget.valueAsNumber })}
        />
        <Checkbox
          label="Scheduled"
          checked={value.enabled}
          onChange={(event) =>
            setValue((current) => ({ ...current, enabled: event.target.checked }))
          }
        />
        <p>
          Web is included. <a href="/settings/runs">Check delivery setup</a>
        </p>
        {error && <p role="alert">{error}</p>}
      </div>
    </ModalSheet>
  );
}
