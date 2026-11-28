import { useState } from 'react';
import { Button, SegmentedControl } from '../components/controls';
import { ModalSheet } from '../components/Sheet';

// Canonical stored palette values. The surrounding interface uses theme tokens.
const colors = [
  { name: 'amber', value: '#c98a1c' },
  { name: 'sage', value: '#6e9278' },
  { name: 'plum', value: '#8c6a9a' },
  { name: 'sky', value: '#5e86a8' },
];
export function HighlightValue({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const name = colors.find((color) => color.value === value.toLowerCase())?.name ?? value;
  return (
    <>
      <button
        type="button"
        className="brew-token brew-token--value brew-token--md"
        aria-label="Highlight color"
        aria-haspopup="dialog"
        data-brew-action="set-rule-highlight"
        onClick={() => setOpen(true)}
      >
        {name}
      </button>
      <ModalSheet
        open={open}
        title="Highlight color"
        onClose={() => setOpen(false)}
        footer={<Button onClick={() => setOpen(false)}>Done</Button>}
      >
        <SegmentedControl
          label="Highlight palette"
          value={value}
          options={colors.map((color) => ({ value: color.value, label: color.name }))}
          onValueChange={onChange}
        />
        <label className="mt-5 flex items-center gap-3">
          Custom color
          <input
            type="color"
            aria-label="Custom highlight color"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
      </ModalSheet>
    </>
  );
}
