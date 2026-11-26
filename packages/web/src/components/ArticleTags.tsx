import type { TagSummary } from '@brew/core/types/api';
import type { useTagEditor } from '../hooks/useTagEditor';

type Editor = ReturnType<typeof useTagEditor>;
export function TagFeedback({ editor }: { editor: Editor }) {
  return (
    <>
      {editor.tags.isPending && (
        <p role="status" aria-label="Tag result" aria-live="polite">
          Loading tags…
        </p>
      )}
      {editor.tags.isError && (
        <div role="alert">
          <p>Could not load tags.</p>
          <button
            type="button"
            className="brew-button brew-button--secondary brew-button--sm"
            data-brew-action="retry-tags"
            disabled={editor.tags.isFetching}
            onClick={() => void editor.tags.refetch()}
          >
            {editor.tags.isFetching ? 'Retrying tags…' : 'Retry tags'}
          </button>
        </div>
      )}
      {!editor.tags.isPending && (
        <p
          role="status"
          aria-label="Tag result"
          aria-live="polite"
          aria-atomic="true"
          className={editor.pending || editor.message ? 'text-sm text-soft' : 'sr-only'}
        >
          {editor.pending ? 'Saving tags…' : editor.message}
        </p>
      )}
      {editor.error && (
        <div role="alert" className="text-sm text-danger">
          <p>{editor.error}</p>
          {editor.failed && (
            <button
              type="button"
              data-brew-action="retry-tag-change"
              className="brew-button brew-button--secondary brew-button--sm"
              disabled={editor.pending || !editor.ready}
              onClick={() => void editor.retry()}
            >
              Retry tag change
            </button>
          )}
        </div>
      )}
    </>
  );
}

export function ArticleTags({
  editor,
  assigned,
  id,
  feedback = true,
}: {
  editor: Editor;
  assigned: TagSummary[];
  id: number;
  feedback?: boolean;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-line bg-canvas p-4" aria-busy={editor.pending}>
      <p className="text-xs font-semibold uppercase tracking-wider text-soft">Tags</p>
      {feedback && <TagFeedback editor={editor} />}
      {editor.tags.isSuccess && editor.tags.data.length === 0 && (
        <p className="mt-3 text-sm text-soft">No tags yet. Add one below.</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {editor.tags.data?.map((tag) => {
          const active = assigned.some((item) => item.id === tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              aria-pressed={active}
              data-brew-id={id}
              data-tag-id={tag.id}
              data-brew-action="set-tag"
              disabled={editor.pending || !editor.ready}
              onClick={() =>
                void editor.save({ add: active ? [] : [tag.id], remove: active ? [tag.id] : [] })
              }
              className={`min-h-8 max-w-full break-words rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${active ? 'bg-inverse text-on-inverse' : 'border border-line-strong bg-surface'}`}
            >
              {tag.name}
            </button>
          );
        })}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!editor.name.trim()) {
            editor.invalidName();
            return;
          }
          void editor.save({ add: [], remove: [] }, editor.name);
        }}
      >
        <label className="sr-only" htmlFor={`new-tag-${id}`}>
          New tag
        </label>
        <input
          id={`new-tag-${id}`}
          value={editor.name}
          onChange={(event) => editor.setName(event.target.value)}
          required
          disabled={editor.pending}
          placeholder="New tag"
          className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm"
        />
        <button
          type="submit"
          data-brew-action="add-tag"
          disabled={editor.pending || !editor.ready}
          className="rounded-lg bg-inverse px-3 text-xs font-semibold text-on-inverse disabled:opacity-50"
        >
          Add
        </button>
      </form>
    </div>
  );
}
