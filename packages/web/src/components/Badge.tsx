import type { ReactNode } from 'react';
import { runAssets } from './figmaAssets';

export type BadgeTone = 'positive' | 'warning' | 'locked' | 'neutral' | 'accent';
export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`brew-badge brew-badge--${tone}`}>
      {(tone === 'positive' || tone === 'warning') && (
        <img src={tone === 'positive' ? runAssets.positiveDot : runAssets.warningDot} alt="" />
      )}
      {children}
    </span>
  );
}
