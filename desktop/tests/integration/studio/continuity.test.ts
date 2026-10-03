import { afterEach, describe, expect, it } from 'vitest';
import { StudioStore } from '../../../packages/desktop/src/process/services/studio/store';
import { compilePrd } from '../../../packages/desktop/src/process/services/studio/methods';

const stores: StudioStore[] = [];
const setup = () => {
  const store = new StudioStore(':memory:');
  stores.push(store);
  const project = store.createProject('连续创作', '减少重复整理');
  return { store, project };
};
afterEach(() => stores.splice(0).forEach((s) => s.close()));

describe('normal continuity', () => {
  it('keeps the confirmed preference and its version in a portable project', () => {
    const { store, project } = setup();
    const pref = store.createItem(null, 'preference', '简约', { key: 'style', content: '减少装饰' });
    const confirmed = store.confirmItem(pref.id, 1);
    store.createItem(project.id, 'artifact', 'PRD', compilePrd(project, [], [confirmed]));
    const other = setup().store;
    const imported = other.importProject(store.exportProject(project.id));
    const adopted = other.items(imported.id, 'preference')[0];
    expect(adopted?.body.content).toBe('减少装饰');
    expect(adopted?.status).toBe('suggested');
    expect(other.versions(adopted.id).some((v) => v.snapshot.status === 'confirmed')).toBe(true);
  });
});

describe('adversarial continuity', () => {
  it('flags a PRD when a new requirement or the first blueprint is added later', () => {
    const { store, project } = setup();
    const doc = store.createItem(project.id, 'artifact', '只有想法的PRD', compilePrd(project, [], []));
    store.confirmItem(doc.id, 1);
    const requirement = store.createItem(project.id, 'requirement', '新范围', {
      content: '新增离线录入',
      normal: '',
      adverse: '',
      priority: 'first',
    });
    expect(store.getItem(doc.id).status).toBe('possibly_stale');
    expect(store.getItem(doc.id).body.staleReasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceId: requirement.id })])
    );
  });
  it('flags transitive material changes without rewriting the historical quote', () => {
    const { store, project } = setup();
    const material = store.createItem(project.id, 'material', '访谈', { content: '我每周整理两次' });
    const citation = store.createItem(project.id, 'citation', '频率', { sourceId: material.id, quote: '每周整理两次' });
    const doc = store.createItem(project.id, 'artifact', 'PRD', compilePrd(project, store.items(project.id), []));
    store.confirmItem(doc.id, 1);
    store.updateItem(material.id, 1, { body: { content: '现在每周一次' } });
    expect(store.getItem(doc.id).status).toBe('possibly_stale');
    expect(store.getItem(citation.id).body.sourceVersion).toBe(1);
    expect(store.getItem(citation.id).body.quote).toBe('每周整理两次');
  });
  it.each(['workflow', 'preference'] as const)('flags a changed %s that the document adopted', (kind) => {
    const { store, project } = setup();
    let source = store.createItem(kind === 'preference' ? null : project.id, kind, '依据', {
      content: '原答案',
      complete: true,
    });
    if (kind === 'preference') source = store.confirmItem(source.id, 1);
    const doc = store.createItem(
      project.id,
      'artifact',
      'PRD',
      compilePrd(project, store.items(project.id), kind === 'preference' ? [source] : [])
    );
    store.confirmItem(doc.id, 1);
    store.updateItem(source.id, source.version, { body: { content: '新答案', complete: true } });
    const changed = store.getItem(doc.id);
    expect(changed.status).toBe('possibly_stale');
    expect(changed.body.staleReasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceId: source.id })])
    );
  });
  it('flags a changed project intent while keeping the old generated text', () => {
    const { store, project } = setup();
    const doc = store.createItem(project.id, 'artifact', 'PRD', compilePrd(project, [], []));
    store.confirmItem(doc.id, 1);
    store.updateProject(project.id, { intent: '改为优先手机采集' });
    expect(store.getItem(doc.id).status).toBe('possibly_stale');
    expect(store.getItem(doc.id).body.content).toContain('减少重复整理');
  });
});
