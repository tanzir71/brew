import type { ReactNode } from 'react';
import { ExportedIcon } from './ExportedIcon';

export type BadgeTone = 'positive' | 'warning' | 'locked' | 'neutral' | 'accent';
export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`brew-badge brew-badge--${tone}`}>
      {tone === 'locked' ? (
        <ExportedIcon name="lock" />
      ) : (
        <span className="brew-badge-dot" aria-hidden="true" />
      )}
      {children}
    </span>
  );
}
