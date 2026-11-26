import type { ReactNode } from 'react';
import { OwnerActionConfirmation, OwnerActionResult } from './OwnerActionParts';
import type { useOwnerActions } from '../hooks/useOwnerActions';
export { OwnerActionConfirmation, OwnerActionResult } from './OwnerActionParts';

export function OwnerActionUi({
  action,
  children,
}: {
  action: ReturnType<typeof useOwnerActions>;
  children?: ReactNode;
}) {
  return (
    <>
      <OwnerActionConfirmation action={action}>{children}</OwnerActionConfirmation>
      <OwnerActionResult action={action} />
    </>
  );
}
