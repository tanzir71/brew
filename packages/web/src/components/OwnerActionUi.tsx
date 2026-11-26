import type { ReactNode, RefObject } from 'react';
import { OwnerActionConfirmation, OwnerActionResult } from './OwnerActionParts';
import type { useOwnerActions } from '../hooks/useOwnerActions';
export { OwnerActionConfirmation, OwnerActionResult } from './OwnerActionParts';

export function OwnerActionUi({
  action,
  children,
  returnFocusRef,
  handlesUndoFocus = false,
}: {
  action: ReturnType<typeof useOwnerActions>;
  children?: ReactNode;
  returnFocusRef?: RefObject<HTMLElement>;
  handlesUndoFocus?: boolean;
}) {
  return (
    <>
      <OwnerActionConfirmation action={action} returnFocusRef={returnFocusRef}>
        {children}
      </OwnerActionConfirmation>
      <OwnerActionResult
        action={action}
        returnFocusRef={returnFocusRef}
        handlesUndoFocus={handlesUndoFocus}
      />
    </>
  );
}
