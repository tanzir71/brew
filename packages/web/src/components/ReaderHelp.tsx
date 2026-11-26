import { useEffect, useState } from 'react';
import { ModalSheet } from './Sheet';
import { Button } from './controls';
import { agentPageHref } from '../agentLocation';

const groups = [
  [
    'Move',
    [
      ['j / k', 'Next / previous article'],
      ['o / Enter', 'Open article'],
      ['Esc', 'Close article'],
    ],
  ],
  [
    'Act',
    [
      ['m', 'Toggle read'],
      ['s', 'Toggle star'],
      ['t', 'Edit tags'],
      ['v', 'Open original'],
      ['Shift + A', 'Mark all read'],
      ['r', 'Refresh'],
    ],
  ],
  [
    'Go',
    [
      ['g b', 'The Brew'],
      ['g t', 'Today'],
      ['g a', 'All articles'],
      ['/', 'Search'],
    ],
  ],
  [
    'View',
    [
      ['1 / 2 / 3', 'Title / magazine / cards'],
      ['?', 'This shortcut guide'],
    ],
  ],
] as const;

export function ReaderHelp({ reader }: { reader: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    const close = () => setOpen(false);
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.key !== '?'
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.matches('input,textarea,select') ||
          target.isContentEditable ||
          target.closest('dialog[open]'))
      )
        return;
      event.preventDefault();
      window.dispatchEvent(new Event('brew:show-shortcuts'));
    };
    window.addEventListener('brew:show-shortcuts', show);
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('popstate', close);
    return () => {
      window.removeEventListener('brew:show-shortcuts', show);
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('popstate', close);
    };
  }, []);
  return (
    <ModalSheet
      open={open}
      onClose={() => setOpen(false)}
      title="Keyboard shortcuts"
      description="Use these shortcuts in Reader."
      footer={
        <>
          {!reader && (
            <a
              href={agentPageHref('/all')}
              data-brew-action="open-reader"
              className="brew-button brew-button--secondary brew-button--md"
            >
              Open Reader
            </a>
          )}
          <Button data-brew-action="close-shortcuts" onClick={() => setOpen(false)}>
            Done
          </Button>
        </>
      }
    >
      <div className="grid gap-7 sm:grid-cols-2">
        {groups.map(([title, rows]) => (
          <section key={title}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
            <dl className="mt-2 space-y-2">
              {rows.map(([keys, label]) => (
                <div key={keys} className="flex items-center justify-between gap-4 text-sm">
                  <dt className="text-soft">{label}</dt>
                  <dd>
                    <kbd className="rounded-md border border-line-strong bg-canvas px-2 py-1 font-mono text-xs">
                      {keys}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </ModalSheet>
  );
}
