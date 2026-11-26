import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { opmlDocument, opmlDocumentLimit, type OpmlPreview } from '@brew/core/opml';
import type { useOwnerActions } from './useOwnerActions';

export function useOpmlImport(action: ReturnType<typeof useOwnerActions>) {
  const latestAction = useRef(action);
  useLayoutEffect(() => {
    latestAction.current = action;
  }, [action]);
  const [draft, setDraft] = useState<{ name: string; xml: string } | null>(null);
  const [preview, setPreview] = useState<{ name: string; data: OpmlPreview } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const prepare = async (name: string, read: () => Promise<string>) => {
    if (!action.capable || action.busy || action.intent) return;
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setPreparing(true);
    setError('');
    setPreview(null);
    setDraft(null);
    try {
      const xml = opmlDocument(await read());
      if (active.signal.aborted) return;
      setDraft({ name, xml });
      const response = await fetch('/api/opml/preview', {
        method: 'POST',
        body: xml,
        signal: active.signal,
        cache: 'no-store',
        headers: { 'Content-Type': 'text/x-opml' },
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? 'Could not read OPML. Try again.');
      if (active.signal.aborted) return;
      const current = latestAction.current;
      if (!current.capable || current.busy || current.intent)
        throw new Error('Finish the current action, then retry the OPML preview.');
      setPreview({ name, data: value as OpmlPreview });
      setDraft(null);
      current.ask({ kind: 'import_opml', opml: xml }, 'OPML');
    } catch (failure) {
      if (!active.signal.aborted) setError((failure as Error).message);
    } finally {
      if (!active.signal.aborted) setPreparing(false);
    }
  };
  return {
    capable: action.capable,
    preparing,
    error,
    preview: action.intent?.request.kind === 'import_opml' ? preview : null,
    pick: (file: File) =>
      prepare(file.name, () =>
        file.size > opmlDocumentLimit
          ? Promise.reject(new Error('Choose an OPML file smaller than 1 MB.'))
          : file.text(),
      ),
    retry: draft ? () => prepare(draft.name, async () => draft.xml) : null,
    cancel: () => {
      controller.current?.abort();
      setPreparing(false);
      setError('');
      setDraft(null);
      setPreview(null);
    },
  };
}
