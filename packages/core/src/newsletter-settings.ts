import { cleanNewsletterHtml } from './newsletter-cleaner.js';
import {
  defaultNewsletterSettings,
  type NewsletterSettings,
  type NewsletterSettingsPatch,
} from './types/newsletters.js';
import type { BrewSection } from './types/brew.js';
import { newBrewSection } from './composition-model.js';

export const newsletterManagedSectionId = 'brew:newsletter-senders';
export function newsletterBrewSections(
  input: BrewSection[],
  senderId: number,
  assigned: boolean,
): BrewSection[] {
  const sections = structuredClone(input);
  if (!assigned)
    return sections.flatMap((section) => {
      if (section.id !== newsletterManagedSectionId) return [section];
      const sources = section.sources.filter(
        (source) => !(source.kind === 'feed' && source.id === senderId),
      );
      return sources.length ? [{ ...section, sources }] : [];
    });
  if (
    sections.some((section) =>
      section.sources.some((source) => source.kind === 'feed' && source.id === senderId),
    )
  )
    return sections;
  const section = sections.find((item) => item.id === newsletterManagedSectionId);
  if (section) section.sources.push({ kind: 'feed', id: senderId });
  else
    sections.push({
      ...newBrewSection(newsletterManagedSectionId),
      title: 'From your newsletters',
      sources: [{ kind: 'feed', id: senderId }],
      layout: 'grid',
      depth: 'excerpt',
    });
  return sections;
}
/** Merge a partial preference update inside the storage adapter's transaction. */
export function updateNewsletterSettings(
  current: NewsletterSettings,
  input: unknown,
): NewsletterSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Sender settings must be an object.');
  const patch = input as NewsletterSettingsPatch;
  const allowed = new Set([
    'favorite',
    'skipInbox',
    'blocked',
    'onlyInBrew',
    'brewId',
    'retentionDays',
    'cleaning',
  ]);
  for (const key of Object.keys(input))
    if (!allowed.has(key)) throw new Error(`Unknown sender setting: ${key}`);
  for (const key of ['favorite', 'skipInbox', 'blocked', 'onlyInBrew'] as const)
    if (key in patch && typeof patch[key] !== 'boolean')
      throw new Error(`${key} must be true or false.`);
  if (
    'brewId' in patch &&
    patch.brewId !== null &&
    (!Number.isSafeInteger(patch.brewId) || patch.brewId! < 1)
  )
    throw new Error('Choose a valid Brew.');
  if (
    'retentionDays' in patch &&
    (!Number.isSafeInteger(patch.retentionDays) ||
      patch.retentionDays! < 1 ||
      patch.retentionDays! > 3650)
  )
    throw new Error('Retention must be between 1 and 3650 days.');
  if ('cleaning' in patch) {
    if (
      !patch.cleaning ||
      typeof patch.cleaning !== 'object' ||
      Array.isArray(patch.cleaning) ||
      Object.keys(patch.cleaning).some(
        (key) => !['sponsorSelectors', 'footerSelectors'].includes(key),
      )
    )
      throw new Error('Invalid cleaning settings.');
    cleanNewsletterHtml('', patch.cleaning);
  }
  const result = { ...defaultNewsletterSettings(), ...current, ...patch } as NewsletterSettings;
  if (patch.brewId === null) delete result.brewId;
  if (result.onlyInBrew && !result.brewId)
    throw new Error('Choose a Brew before enabling Only in Brew.');
  return result;
}
