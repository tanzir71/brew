import { useState } from 'react';
import type { BrewConfigDraft } from '@brew/core/types/brew';
import { validateComposition } from '@brew/core/composition-model';
import { ModalSheet } from '../components/Sheet';
import { Button, Checkbox, Input } from '../components/controls';

export { SourcePicker } from './SourcePicker';
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
