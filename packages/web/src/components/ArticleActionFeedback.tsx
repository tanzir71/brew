import type { useArticleActions } from '../hooks/useArticleActions';

export function ArticleActionFeedback({
  actions,
  message,
}: {
  actions: ReturnType<typeof useArticleActions>;
  message: string;
}) {
  return (
    <>
      {(actions.pending || message || actions.message) && (
        <p
          role="status"
          aria-label="Article action result"
          aria-live="polite"
          aria-atomic="true"
          className="mt-3 text-sm text-soft"
        >
          {actions.pending ? 'Saving article…' : message || actions.message}
        </p>
      )}
      {(['read', 'starred'] as const).map((field) => {
        const failure = actions.failures[field];
        return (
          failure && (
            <div key={field} role="alert" className="mt-3 text-sm text-danger">
              <p>{failure.message}</p>
              <button
                type="button"
                className="brew-button brew-button--secondary brew-button--sm"
                data-brew-action="retry-article-change"
                onClick={() => void actions.update({ [field]: failure.value })}
              >
                {field === 'read' ? 'Retry read change' : 'Retry star change'}
              </button>
            </div>
          )
        );
      })}
    </>
  );
}
