import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

function visible(element: HTMLElement, root: HTMLElement) {
  const box = element.getBoundingClientRect();
  const bounds = root.getBoundingClientRect();
  return (
    element.isConnected &&
    box.width > 0 &&
    box.height > 0 &&
    box.bottom > Math.max(0, bounds.top) &&
    box.top < Math.min(innerHeight, bounds.bottom) &&
    box.right > Math.max(0, bounds.left) &&
    box.left < Math.min(innerWidth, bounds.right)
  );
}

/** Virtual rows can disappear after opening an unread item. Return to a visible neighbour. */
export function useArticleFocusReturn(
  list: RefObject<HTMLElement>,
  items: readonly { id: number }[],
  heading: RefObject<HTMLElement>,
) {
  const latest = useRef(items);
  const origin = useRef<{ id: number; index: number; button: HTMLElement | null } | null>(null);
  const returned = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    latest.current = items;
  }, [items]);
  const prepareArticle = useCallback(
    (id: number) => {
      origin.current = {
        id,
        index: Math.max(
          0,
          latest.current.findIndex((item) => item.id === id),
        ),
        button:
          list.current?.querySelector<HTMLElement>(
            `[data-brew-id="${id}"] [data-brew-action="open"]`,
          ) ?? null,
      };
      returned.current = null;
    },
    [list],
  );
  const articleReturnTarget = useCallback(() => {
    const root = list.current;
    const saved = origin.current;
    if (!root || !saved) return heading.current;
    if (saved.button && visible(saved.button, root)) {
      returned.current = saved.button;
      return saved.button;
    }
    const index = latest.current.findIndex((item) => item.id === saved.id);
    const targetIndex = index < 0 ? Math.min(saved.index, latest.current.length - 1) : index;
    const candidates = [...root.querySelectorAll<HTMLElement>('[data-brew-action="open"]')]
      .filter((button) => visible(button, root))
      .map((button) => ({
        button,
        index: latest.current.findIndex(
          (item) =>
            String(item.id) === button.closest('[data-brew-id]')?.getAttribute('data-brew-id'),
        ),
      }))
      .filter((candidate) => candidate.index >= 0)
      .sort((a, b) => Math.abs(a.index - targetIndex) - Math.abs(b.index - targetIndex));
    returned.current = candidates[0]?.button ?? heading.current;
    return returned.current;
  }, [heading, list]);
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (
        returned.current &&
        !returned.current.isConnected &&
        document.activeElement === document.body &&
        !document.querySelector('dialog[open]')
      )
        articleReturnTarget()?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [articleReturnTarget, items]);
  return { prepareArticle, articleReturnTarget };
}
