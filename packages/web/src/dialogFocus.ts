import type { FocusEvent, KeyboardEvent } from 'react';

/** Native media controls can consume Tab inside their closed browser shadow tree. */
export function containDialogBlur(event: FocusEvent<HTMLDialogElement>) {
  const dialog = event.currentTarget;
  if (event.relatedTarget instanceof Node && dialog.contains(event.relatedTarget)) return;
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (
      dialog.open &&
      dialog.isConnected &&
      dialog.matches(':modal') &&
      !dialog.contains(active) &&
      !active?.closest('dialog[open]')
    )
      dialog
        .querySelector<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled)',
        )
        ?.focus();
  });
}

export function containDialogTab(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
  const dialog = event.currentTarget;
  const controls = [
    ...dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), audio[controls], video[controls], summary, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((control) => control.getClientRects().length && !control.matches(':disabled'));
  const first = controls[0];
  const last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last && !last?.matches('audio,video')) {
    event.preventDefault();
    first?.focus();
  }
}
