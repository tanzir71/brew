export function articleRouteId(path: string): number | null {
  const match = path.match(/^\/a\/([1-9]\d*)\/?$/);
  const id = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(id) ? id : null;
}
