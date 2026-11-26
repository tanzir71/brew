export function PageControls({
  page,
  pageSize,
  total,
  href,
  navigate,
  label,
  numbered = true,
  action = 'page',
}: {
  page: number;
  pageSize: number;
  total: number;
  href: (page: number) => string;
  navigate: (href: string, page: number, trigger: HTMLAnchorElement) => void;
  label: string;
  numbered?: boolean;
  action?: string;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const numbers = [
    ...new Set([
      1,
      lastPage,
      page,
      ...Array.from({ length: 5 }, (_, i) => page + i - 2).filter(
        (value) => value >= 1 && value <= lastPage,
      ),
    ]),
  ].sort((a, b) => a - b);
  const link = (value: number, text: string) => (
    <a
      className="brew-button brew-button--secondary brew-button--sm"
      href={href(value)}
      aria-label={text.startsWith('Page ') ? text : undefined}
      data-brew-action={action}
      data-brew-page={value}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        navigate(event.currentTarget.getAttribute('href')!, value, event.currentTarget);
      }}
    >
      {text.startsWith('Page ') ? text.slice(5) : text}
    </a>
  );
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-2">
      {page > 1 ? (
        link(page - 1, 'Previous')
      ) : (
        <button className="brew-button brew-button--secondary brew-button--sm" disabled>
          Previous
        </button>
      )}
      {numbered ? (
        <>
          <span className="sr-only">
            Page {page}
            {page <= lastPage ? ` of ${lastPage}` : ` · ${lastPage} available`}
          </span>
          {numbers.map((value, index) => (
            <span key={value} className="inline-flex items-center gap-2">
              {index > 0 && value - numbers[index - 1]! > 1 && <span aria-hidden="true">…</span>}
              {value === page ? (
                <span
                  aria-current="page"
                  aria-label={`Page ${value}`}
                  className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-md bg-subtle"
                >
                  {value}
                </span>
              ) : (
                link(value, `Page ${value}`)
              )}
            </span>
          ))}
        </>
      ) : (
        <span aria-current="page">Page {page}</span>
      )}
      {page * pageSize < total ? (
        link(page + 1, 'Next')
      ) : (
        <button className="brew-button brew-button--secondary brew-button--sm" disabled>
          Next
        </button>
      )}
    </nav>
  );
}
