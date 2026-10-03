import type {
  StudioConnection,
  StudioItem,
  StudioKind,
  StudioBody,
  StudioPatch,
  StudioProject,
} from '@/common/types/studio';

function connection(): StudioConnection {
  const value = (window as Window & { __studioConnection?: StudioConnection }).__studioConnection;
  if (!value?.port || !value.token) throw new Error('SERVICE_UNAVAILABLE');
  return value;
}
export function lifecycle() {
  return (
    window as Window & {
      __studioLifecycle?: {
        setDirty: (dirty: boolean) => void;
        confirmQuit: () => void;
        onQuitRequested: (callback: () => void) => () => void;
      };
    }
  ).__studioLifecycle;
}
export async function request(path: string, options: RequestInit = {}): Promise<Response> {
  const host = connection();
  const response = await fetch(`http://127.0.0.1:${host.port}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${host.token}`, ...options.headers },
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({ error: 'CONNECTION_FAILED' }))) as { error?: string };
    throw new Error(data.error ?? 'CONNECTION_FAILED');
  }
  return response;
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  return (
    await request(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(method === 'POST' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  ).json() as Promise<T>;
}
export const itemsPath = (projectId: string | null): string =>
  projectId ? `/projects/${projectId}/items` : '/inbox/items';
export const createItem = (
  projectId: string | null,
  kind: StudioKind,
  title: string,
  body: StudioBody
): Promise<StudioItem> => api(itemsPath(projectId), 'POST', { kind, title, body });
export const saveItem = (item: StudioItem, patch: StudioPatch): Promise<StudioItem> =>
  api(`/items/${item.id}`, 'PATCH', { version: item.version, ...patch });
export async function uploadMaterial(projectId: string, file: File): Promise<StudioItem> {
  return (
    await request(`/projects/${projectId}/upload?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    })
  ).json() as Promise<StudioItem>;
}
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = [...name]
    .map((char) => (char.charCodeAt(0) < 32 || char === '/' || char === '\\' ? '_' : char))
    .join('');
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export const downloadText = (text: string, name: string): void =>
  downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), name);
export async function exportProject(project: StudioProject): Promise<void> {
  downloadBlob(await (await request(`/projects/${project.id}/export`)).blob(), `${project.title}.origin.json`);
}
