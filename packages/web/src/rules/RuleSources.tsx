import { useState } from 'react';
import type { ReaderNavigation } from '@brew/core/types/api';
import type { RuleScope } from '@brew/core/types/rules';
import { ModalSheet } from '../components/Sheet';
import { Button, Checkbox } from '../components/controls';
import { Icon } from '../components/Icon';

export function RuleSources({
  scope,
  navigation,
  onChange,
}: {
  scope: RuleScope;
  navigation: ReaderNavigation;
  onChange: (scope: RuleScope) => void;
}) {
  const [open, setOpen] = useState(false);
  const feeds = [...navigation.folders.flatMap((folder) => folder.feeds), ...navigation.unfiled];
  const labels = [
    ...(scope.folderIds ?? []).map(
      (id) => navigation.folders.find((folder) => folder.id === id)?.title ?? `Folder ${id}`,
    ),
    ...(scope.feedIds ?? []).map(
      (id) => feeds.find((feed) => feed.id === id)?.title ?? `Feed ${id}`,
    ),
  ];
  const change = (key: 'folderIds' | 'feedIds', id: number, checked: boolean) => {
    const current = scope[key] ?? [];
    onChange({
      ...scope,
      [key]: checked ? [...new Set([...current, id])] : current.filter((value) => value !== id),
    });
  };
  return (
    <>
      {(labels.length ? labels : ['all feeds']).map((label, index) => (
        <button
          key={index}
          type="button"
          className="brew-token brew-token--field brew-token--md"
          aria-label={index === 0 ? 'Rule scope' : `Rule scope · ${label}`}
          data-brew-action="set-rule-scope"
          onClick={() => setOpen(true)}
        >
          {label}
          <Icon name="chevron-down" size={12} />
        </button>
      ))}
      <ModalSheet
        open={open}
        title="Rule sources"
        onClose={() => setOpen(false)}
        footer={<Button onClick={() => setOpen(false)}>Done</Button>}
      >
        <p className="text-sm text-soft">Match articles in any of these feeds or folders.</p>
        <div className="mt-4 flex flex-col gap-4">
          <Checkbox
            label="All feeds"
            checked={labels.length === 0}
            onChange={(event) => {
              if (event.target.checked) onChange({});
            }}
          />
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 text-sm font-medium">Folders</legend>
            {navigation.folders.map((folder) => (
              <Checkbox
                key={folder.id}
                label={folder.title}
                checked={scope.folderIds?.includes(folder.id) ?? false}
                onChange={(event) => change('folderIds', folder.id, event.target.checked)}
              />
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 text-sm font-medium">Feeds</legend>
            {feeds.map((feed) => (
              <Checkbox
                key={feed.id}
                label={feed.title}
                checked={scope.feedIds?.includes(feed.id) ?? false}
                onChange={(event) => change('feedIds', feed.id, event.target.checked)}
              />
            ))}
          </fieldset>
        </div>
      </ModalSheet>
    </>
  );
}
