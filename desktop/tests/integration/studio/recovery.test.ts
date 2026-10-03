import { afterEach, describe, expect, it } from 'vitest';
import { StudioStore } from '../../../packages/desktop/src/process/services/studio/store';
import { validateCanvas } from '../../../packages/desktop/src/common/studio/canvas';
const stores: StudioStore[] = [];
const open = () => {
  const s = new StudioStore(':memory:');
  stores.push(s);
  return s;
};
afterEach(() => stores.splice(0).forEach((s) => s.close()));

describe('normal recovery', () => {
  it('keeps a referenced global preference as a project-scoped snapshot when exporting', () => {
    const s = open();
    const p = s.createProject('偏好来源', '');
    const pref = s.createItem(null, 'preference', '表达', { content: '简洁' });
    s.confirmItem(pref.id, pref.version);
    s.createItem(p.id, 'artifact', '规范', { content: '简洁表达', sourceIds: [pref.id] });
    const copied = s.importProject(s.exportProject(p.id));
    const local = s.items(copied.id);
    const localPref = local.find((i) => i.kind === 'preference')!;
    expect(localPref.projectId).toBe(copied.id);
    expect(localPref.status).toBe('suggested');
    expect(local.find((i) => i.kind === 'artifact')?.body.sourceIds).toEqual([localPref.id]);
  });
  it('remaps document links and version-map keys without rewriting source prose', () => {
    const s = open();
    const p = s.createProject('归档复原', '');
    const m = s.createItem(p.id, 'material', '原话', { content: '一个原始判断' });
    s.createItem(p.id, 'artifact', '文档', {
      content: `[来源](origin://item/${m.id})\n原始标识 ${m.id}`,
      sourceIds: [m.id],
      sourceVersions: { [m.id]: 1 },
    });
    const copy = s.importProject(s.exportProject(p.id));
    const items = s.items(copy.id);
    const newMaterial = items.find((i) => i.kind === 'material')!;
    const document = items.find((i) => i.kind === 'artifact')!;
    expect(document.body.content).toBe(`[来源](origin://item/${newMaterial.id})\n原始标识 ${m.id}`);
    expect(document.body.sourceVersions).toEqual({ [newMaterial.id]: 1 });
  });
  it('accepts an editable mind map and bounded viewport', () => {
    expect(() =>
      validateCanvas({
        elements: [
          {
            id: 'root',
            type: 'mindmap',
            points: [[0, 0]],
            data: { topic: { children: [{ text: '想法' }] } },
            children: [],
          },
        ],
        viewport: { zoom: 1, origination: [0, 0] },
      })
    ).not.toThrow();
  });
});
describe('adversarial recovery', () => {
  it.each([
    { elements: [{}] },
    { elements: [{ id: 'a', type: 'geometry', points: [[null, 0]] }] },
    {
      elements: [
        {
          id: 'a',
          type: 'geometry',
          points: [
            [0, 0],
            [5, 5],
          ],
          children: [null],
        },
      ],
    },
    { elements: [], viewport: { zoom: 0, origination: [0, 0] } },
    {
      elements: [
        {
          id: 'x',
          type: 'geometry',
          points: [
            [0, 0],
            [1, 1],
          ],
        },
        {
          id: 'x',
          type: 'geometry',
          points: [
            [1, 1],
            [2, 2],
          ],
        },
      ],
    },
  ])('rejects malformed board data before the renderer mounts', (body) => {
    expect(() => validateCanvas(body)).toThrow('INVALID_CANVAS');
  });
  it('does not let an ordinary item update set a state for another object type', () => {
    const s = open();
    const p = s.createProject('范围', '');
    const a = s.createItem(p.id, 'artifact', '文档', { content: '方案' });
    expect(() => s.updateItem(a.id, 1, { status: 'ignored' })).toThrow('INVALID_STATE');
  });
});
