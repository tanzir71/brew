import type { ReactNode } from 'react';
import { ExportedIcon } from './ExportedIcon';

export type BadgeTone = 'positive' | 'warning' | 'locked' | 'neutral' | 'accent';
export function Badge({
  tone = 'neutral',
  children,
  lead,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  lead?: ReactNode;
}) {
  return (
    <span className={`brew-badge brew-badge--${tone}`}>
      {lead ??
        (tone === 'locked' ? (
          <ExportedIcon name="lock" />
        ) : (
          <span className="brew-badge-dot" aria-hidden="true" />
        ))}
      {children}
    </span>
  );
}
