import { afterEach, describe, expect, it } from 'vitest';
import { StudioStore } from '../../../packages/desktop/src/process/services/studio/store';
const stores: StudioStore[] = [];
const open = () => {
  const s = new StudioStore(':memory:');
  stores.push(s);
  return s;
};
afterEach(() => stores.splice(0).forEach((s) => s.close()));

describe('adversarial studio invariants', () => {
  it('refuses an empty project title and preserves the database', () => {
    const s = open();
    expect(() => s.createProject('  ', '')).toThrow('VALIDATION_FAILED');
    expect(s.projects()).toHaveLength(0);
  });
  it('refuses a decision without basis or alternatives', () => {
    const s = open();
    const p = s.createProject('test', '');
    const d = s.createItem(p.id, 'decision', '跳过确认', { options: ['唯一选项'], selected: '唯一选项' });
    expect(() => s.confirmDecision(d.id, 1)).toThrow('DECISION_INCOMPLETE');
    expect(s.getItem(d.id).status).toBe('draft');
  });
  it('rejects a stale update instead of overwriting another edit', () => {
    const s = open();
    const p = s.createProject('test', '');
    const a = s.createItem(p.id, 'artifact', '文档', { content: '原文' });
    s.updateItem(a.id, 1, { body: { content: '先保存' } });
    expect(() => s.updateItem(a.id, 1, { body: { content: '后覆盖' } })).toThrow('VERSION_CONFLICT');
    expect(s.getItem(a.id).body.content).toBe('先保存');
  });
  it('rejects a citation into another project', () => {
    const s = open();
    const a = s.createProject('A', '');
    const b = s.createProject('B', '');
    const m = s.createItem(a.id, 'material', '原文', { content: '秘密' });
    expect(() => s.createItem(b.id, 'citation', '越界', { sourceId: m.id, quote: '秘密' })).toThrow(
      'INVALID_REFERENCE'
    );
  });
  it('rejects an invented quotation rather than presenting it as evidence', () => {
    const s = open();
    const p = s.createProject('A', '');
    const m = s.createItem(p.id, 'material', '原文', { content: '真实原文' });
    expect(() => s.createItem(p.id, 'citation', '伪造', { sourceId: m.id, quote: '从没说过' })).toThrow(
      'INVALID_QUOTE'
    );
  });
  it('rejects arbitrary status upgrades on an ordinary update', () => {
    const s = open();
    const p = s.createProject('A', '');
    const d = s.createItem(p.id, 'decision', '直接决定', {});
    expect(() => s.updateItem(d.id, 1, { status: 'decided' })).toThrow('CONFIRMATION_REQUIRED');
  });
  it('rejects a corrupted export before creating any project', () => {
    const s = open();
    const p = s.createProject('A', '');
    const pack = s.exportProject(p.id);
    pack.project.title = '篡改';
    expect(() => s.importProject(pack)).toThrow('INTEGRITY_FAILED');
    expect(s.projects()).toHaveLength(1);
  });
});
