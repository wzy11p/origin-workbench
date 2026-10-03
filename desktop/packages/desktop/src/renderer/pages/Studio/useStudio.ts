import { useCallback, useEffect, useRef, useState } from 'react';
import type { StudioItem, StudioProject } from '@/common/types/studio';
import { api, itemsPath } from './client';

const sameItems = (before: StudioItem[], after: StudioItem[]): boolean =>
  before.length === after.length &&
  before.every((item, index) => item.id === after[index].id && item.version === after[index].version);
const sameProjects = (before: StudioProject[], after: StudioProject[]): boolean =>
  before.length === after.length &&
  before.every((project, index) => {
    const next = after[index];
    return (
      project.id === next.id &&
      project.title === next.title &&
      project.intent === next.intent &&
      project.stage === next.stage &&
      project.archived === next.archived &&
      project.updatedAt === next.updatedAt
    );
  });

export function useStudio(projectId?: string) {
  const requested = useRef(projectId);
  requested.current = projectId;
  const sequence = useRef(0);
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [items, setItems] = useState<StudioItem[]>([]);
  const [inbox, setInbox] = useState<StudioItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async (): Promise<void> => {
    const ticket = ++sequence.current;
    try {
      const [p, i, global] = await Promise.all([
        api<StudioProject[]>('/projects'),
        projectId ? api<StudioItem[]>(itemsPath(projectId)) : Promise.resolve([]),
        api<StudioItem[]>('/inbox/items'),
      ]);
      if (requested.current !== projectId || sequence.current !== ticket) return;
      setProjects((current) => (sameProjects(current, p) ? current : p));
      setItems((current) => (sameItems(current, i) ? current : i));
      setInbox((current) => (sameItems(current, global) ? current : global));
      setError('');
    } catch (e) {
      if (requested.current !== projectId || sequence.current !== ticket) return;
      setError(e instanceof Error ? e.message : 'CONNECTION_FAILED');
    } finally {
      if (requested.current === projectId && sequence.current === ticket) setLoading(false);
    }
  }, [projectId]);
  useEffect(() => {
    setItems([]);
    setLoading(true);
    let disposed = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Schedule after completion so slow local services cannot accumulate requests.
    const poll = async (initial = false): Promise<void> => {
      if (disposed || running || (!initial && document.hidden)) return;
      running = true;
      await refresh();
      running = false;
      if (!disposed && !document.hidden) timer = setTimeout(() => void poll(), 10_000);
    };
    const onVisibility = (): void => {
      clearTimeout(timer);
      if (!document.hidden) void poll();
    };
    document.addEventListener('visibilitychange', onVisibility);
    void poll(true);
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);
  return { projects, project: projects.find((p) => p.id === projectId), items, inbox, error, loading, refresh };
}
