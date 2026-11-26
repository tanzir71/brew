let locks = 0;
let previous = '';

/** Nested native dialogs release the page only after the last dialog closes. */
export function lockDialogScroll() {
  if (locks++ === 0) {
    previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks === 0) document.body.style.overflow = previous;
  };
}
