import type { DuplicateTitles } from './ports.js';
export const normalizedTitle = (value: string): string =>
  value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
function titleTrigrams(value: string) {
  const text = `  ${normalizedTitle(value)} `,
    result = new Set<string>();
  for (let index = 0; index <= text.length - 3; index++) result.add(text.slice(index, index + 3));
  return result;
}
function trigramScore(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared++;
  return (2 * shared) / (a.size + b.size);
}
export function trigramSimilarity(left: string, right: string): number {
  return trigramScore(titleTrigrams(left), titleTrigrams(right));
}
export function duplicateArticleIds(ids: number[], titles: DuplicateTitles): number[] {
  const subjects = new Map(titles.subjects.map((row) => [row.id, row.title]));
  const cache = new Map<string, Set<string>>();
  const candidateGrams = (title: string) => {
    let grams = cache.get(title);
    if (!grams) {
      grams = titleTrigrams(title);
      if (cache.size >= 256) cache.delete(cache.keys().next().value!);
      cache.set(title, grams);
    }
    return grams;
  };
  return ids.filter((id) => {
    if (!subjects.has(id)) throw new Error('Article not found');
    const grams = titleTrigrams(subjects.get(id)!);
    return titles.recent.some(
      (row) => row.id !== id && trigramScore(grams, candidateGrams(row.title)) >= 0.9,
    );
  });
}
