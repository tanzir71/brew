import type { NewsletterCleaning } from '@brew/core/types/newsletters';

export function newsletterCleaningLabel(cleaning: NewsletterCleaning | null): string {
  if (!cleaning) return 'Cleaning details unavailable';
  if (cleaning.trackers)
    return `${cleaning.trackers} tracker${cleaning.trackers === 1 ? '' : 's'} removed`;
  if (cleaning.sponsorBlocks)
    return cleaning.sponsorBlocks === 1
      ? 'Sponsor block removed'
      : `${cleaning.sponsorBlocks} sponsor blocks removed`;
  return cleaning.footerTrimmed ? 'Footer trimmed' : 'Checked for trackers';
}
