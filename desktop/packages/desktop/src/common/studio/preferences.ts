import type { StudioItem } from '../types/studio';
/** A project preference overrides a global preference with the same user-defined key. */
export function effectivePreferences(
  items: StudioItem[],
  projectId: string
): { active: StudioItem[]; overridden: StudioItem[] } {
  const confirmed = items.filter(
    (i) => i.kind === 'preference' && i.status === 'confirmed' && (i.projectId === null || i.projectId === projectId)
  );
  const key = (i: StudioItem): string =>
    String(i.body.key || i.title)
      .trim()
      .toLocaleLowerCase();
  const local = new Set(confirmed.filter((i) => i.projectId === projectId).map(key));
  return {
    active: confirmed.filter((i) => i.projectId !== null || !local.has(key(i))),
    overridden: confirmed.filter((i) => i.projectId === null && local.has(key(i))),
  };
}
