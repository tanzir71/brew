/** Stable across runtimes and sessions; IDs map to the eight artwork fills. */
export function avatarTone(id: string | number) {
  let hash = 2166136261;
  for (const character of String(id))
    hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619) >>> 0;
  return (hash % 8) + 1;
}
