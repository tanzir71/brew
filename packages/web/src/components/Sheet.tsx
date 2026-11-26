import { useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { IconButton } from './controls';
import { lockDialogScroll } from '../dialogScrollLock';
import { containDialogBlur, containDialogTab } from '../dialogFocus';

type SheetProps = {
  open: boolean;
  className?: string;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement>;
  returnFocusRef?: RefObject<HTMLElement>;
};
function SheetBody({
  side,
  className = '',
  onClose,
  title,
  description,
  children,
  footer,
  initialFocusRef,
  returnFocusRef,
}: Omit<SheetProps, 'open'> & { side: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const previous = returnFocusRef?.current ?? (document.activeElement as HTMLElement | null);
    const unlock = lockDialogScroll();
    dialog.showModal();
    initialFocusRef?.current?.focus();
    return () => {
      dialog.close();
      unlock();
      if (
        previous?.isConnected &&
        previous !== document.body &&
        previous.getClientRects().length &&
        !previous.matches(':disabled')
      )
        previous.focus();
      else document.querySelector<HTMLElement>('main h1[tabindex]')?.focus({ preventScroll: true });
    };
  }, [initialFocusRef, returnFocusRef]);
  return (
    <dialog
      ref={ref}
      className={`brew-sheet ${side ? 'brew-sheet--side' : 'brew-sheet--modal'} ${className}`}
      aria-labelledby={id}
      aria-describedby={description ? `${id}-description` : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDownCapture={containDialogTab}
      onBlurCapture={containDialogBlur}
      onClose={(event) => {
        if (!event.currentTarget.open) onClose();
      }}
      onClick={(event) => {
        const r = event.currentTarget.getBoundingClientRect();
        if (
          event.target === event.currentTarget &&
          (event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom)
        )
          onClose();
      }}
    >
      <header>
        <h2 id={id} className="min-w-0 break-words">
          {title}
        </h2>
        <IconButton icon="x" label={`Close ${title}`} onClick={onClose} />
      </header>
      {description && (
        <p id={`${id}-description`} className="brew-sheet-description">
          {description}
        </p>
      )}
      <div className="brew-sheet-content">{children}</div>
      {footer && <footer>{footer}</footer>}
    </dialog>
  );
}
export function SideSheet({ open, ...props }: SheetProps) {
  return open ? <SheetBody side {...props} /> : null;
}
export function ModalSheet({ open, ...props }: SheetProps) {
  return open ? <SheetBody side={false} {...props} /> : null;
}
