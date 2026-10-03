import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../../packages/desktop/src/process/services/studio/store';

const directories: string[] = [];
const stores: StudioStore[] = [];
const open = (file?: string) => {
  const dir = file ? '' : mkdtempSync(join(tmpdir(), 'origin-test-'));
  if (dir) directories.push(dir);
  const store = new StudioStore(file ?? join(dir, 'studio.db'));
  stores.push(store);
  return store;
};
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
  directories.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

describe('studio creation loop', () => {
  it('persists the original idea after closing and reopening the database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'origin-test-'));
    directories.push(dir);
    const s = open(join(dir, 'db'));
    const p = s.createProject('我的产品', '先保存原话');
    s.createItem(p.id, 'capture', '灵感', { content: '一句没有被改写的想法' });
    s.close();
    expect(open(join(dir, 'db')).items(p.id)[0].body.content).toBe('一句没有被改写的想法');
  });
  it('confirms a decision with alternatives and keeps its historical version', () => {
    const s = open();
    const p = s.createProject('桌面工具', '个人使用');
    const d = s.createItem(p.id, 'decision', '是否先做本地版', {
      options: ['本地', '云端'],
      selected: '本地',
      reason: '个人资料放在本机',
      basis: '当前约束',
    });
    const confirmed = s.confirmDecision(d.id, d.version);
    expect(confirmed.status).toBe('decided');
    expect(s.versions(d.id)).toHaveLength(2);
  });
  it('exports and imports a project with distinct IDs and complete links', () => {
    const s = open();
    const p = s.createProject('流程设计', '完成路径');
    const m = s.createItem(p.id, 'material', '访谈', { content: '希望更方便' });
    s.createItem(p.id, 'citation', '观察', { sourceId: m.id, quote: '希望更方便' });
    const imported = s.importProject(s.exportProject(p.id));
    const items = s.items(imported.id);
    expect(imported.id).not.toBe(p.id);
    expect(items.find((i) => i.kind === 'citation')?.body.sourceId).toBe(items.find((i) => i.kind === 'material')?.id);
  });
  it('marks a linked document as possibly stale when its decision is revised', () => {
    const s = open();
    const p = s.createProject('来源', '可追踪');
    const d = s.createItem(p.id, 'decision', '平台', {
      options: ['桌面', '移动'],
      selected: '桌面',
      reason: '大屏',
      basis: '约束',
    });
    const c = s.confirmDecision(d.id, 1);
    const a = s.createItem(p.id, 'artifact', 'PRD', { content: '先做桌面', sourceIds: [d.id] });
    s.updateItem(d.id, c.version, { body: { ...d.body, selected: '移动' } });
    expect(s.getItem(a.id).status).toBe('possibly_stale');
  });
});
