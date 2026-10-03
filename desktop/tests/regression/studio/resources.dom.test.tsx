import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useStudio } from '@/renderer/pages/Studio/useStudio';
import type { StudioItem, StudioProject } from '@/common/types/studio';

const backend = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/renderer/pages/Studio/client', () => ({
  api: backend.api,
  itemsPath: (id: string) => `/projects/${id}/items`,
}));
const project: StudioProject = {
  id: 'one',
  title: 'Personal studio',
  intent: 'Keep original thoughts',
  stage: '灵感',
  archived: false,
  createdAt: 1,
  updatedAt: 1,
};
let item: StudioItem;
let hidden = false;
beforeEach(() => {
  vi.useFakeTimers();
  backend.api.mockReset();
  hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  item = {
    id: 'note',
    projectId: 'one',
    kind: 'capture',
    title: 'Original',
    body: { content: 'Keep me' },
    status: 'draft',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  backend.api.mockImplementation(async (path: string) =>
    structuredClone(path === '/projects' ? [project] : path === '/projects/one/items' ? [item] : [])
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const settle = async () => {
  await act(async () => undefined);
};
const visibility = async (value: boolean) => {
  hidden = value;
  await act(async () => document.dispatchEvent(new window.Event('visibilitychange')));
};

describe('resource-conscious studio refresh', () => {
  it('normal loads a newly opened page even while its window is hidden', async () => {
    hidden = true;
    const { result } = renderHook(() => useStudio('one'));
    await settle();
    expect(result.current.loading).toBe(false);
    expect(result.current.items[0].body.content).toBe('Keep me');
  });
  it('adversarial a late response from the previous project cannot overwrite the current page', async () => {
    let release!: (items: StudioItem[]) => void;
    const late = new Promise<StudioItem[]>((resolve) => {
      release = resolve;
    });
    backend.api.mockImplementation(async (path: string) => (path === '/projects/one/items' ? late : []));
    const { result, rerender } = renderHook(({ id }) => useStudio(id), { initialProps: { id: 'one' } });
    rerender({ id: 'two' });
    await settle();
    await act(async () => release([item]));
    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
  it('normal loads immediately, preserves unchanged data, and applies an explicit refresh after saving', async () => {
    const { result } = renderHook(() => useStudio('one'));
    await settle();
    expect(result.current.items[0].body.content).toBe('Keep me');
    const original = result.current.items;
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(result.current.items).toBe(original);
    item = { ...item, version: 2, body: { content: 'New decision' } };
    await act(async () => result.current.refresh());
    expect(result.current.items[0].body.content).toBe('New decision');
  });
  it('normal refreshes on return from a hidden window and stops polling after unmount', async () => {
    const { result, unmount } = renderHook(() => useStudio('one'));
    await settle();
    await visibility(true);
    item = { ...item, version: 2, body: { content: 'Ready after parsing' } };
    await visibility(false);
    expect(result.current.items[0].body.content).toBe('Ready after parsing');
    unmount();
    const count = backend.api.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(backend.api).toHaveBeenCalledTimes(count);
  });
  it('adversarial a slow server never accumulates periodic refresh requests', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    backend.api.mockImplementation(async () => {
      await gate;
      return [];
    });
    renderHook(() => useStudio('one'));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(backend.api).toHaveBeenCalledTimes(3);
    await act(async () => release());
  });
  it('adversarial hidden windows stop requests and a failed retry retains existing content', async () => {
    const { result } = renderHook(() => useStudio('one'));
    await settle();
    await visibility(true);
    const count = backend.api.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(backend.api).toHaveBeenCalledTimes(count);
    backend.api.mockRejectedValue(new Error('CONNECTION_FAILED'));
    await visibility(false);
    expect(result.current.error).toBe('CONNECTION_FAILED');
    expect(result.current.items[0].body.content).toBe('Keep me');
  });
});
