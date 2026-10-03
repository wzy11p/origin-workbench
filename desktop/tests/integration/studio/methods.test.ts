import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { StudioStore } from '../../../packages/desktop/src/process/services/studio/store';
import { MethodLibrary, compilePrd, workflowBody } from '../../../packages/desktop/src/process/services/studio/methods';

const root = resolve(process.cwd(), '..');
const library = new MethodLibrary(resolve(root, 'vendor/pm-skills'));
const stores: StudioStore[] = [];
const setup = () => {
  const store = new StudioStore(':memory:');
  stores.push(store);
  return { store, project: store.createProject('原点', '把想法变成可验证的方案') };
};
afterEach(() => stores.splice(0).forEach((s) => s.close()));

describe('normal methods', () => {
  it('offers source-pinned guided steps for the complete personal method chain', () => {
    for (const id of ['discover', 'competitor-analysis', 'identify-assumptions-new', 'create-prd', 'test-scenarios']) {
      const method = library.get(id);
      expect(method.steps.length).toBeGreaterThanOrEqual(5);
      expect(method.content.length).toBeGreaterThan(500);
    }
  });
  it('loads the real method source and retains its identity', () => {
    const method = library.get('create-prd');
    expect(method.content).toContain('8-section');
    expect(method.steps).toHaveLength(8);
    expect(library.list()).toHaveLength(70);
  });
  it('saves completed answers and pins the method revision', () => {
    const m = library.get('pre-mortem');
    const body = workflowBody(
      m,
      m.steps.map(() => '证据与行动'),
      true
    );
    expect(body.complete).toBe(true);
    expect(body.methodVersion).toBe(m.version);
  });
  it('compiles only confirmed decisions while labelling draft material', () => {
    const { store, project } = setup();
    const d = store.createItem(project.id, 'decision', '平台', {
      options: ['桌面', '手机'],
      selected: '桌面',
      reason: '需要大屏',
      basis: '使用场景',
    });
    store.confirmDecision(d.id, 1);
    store.createItem(project.id, 'decision', '待定', { selected: '未确认内容' });
    const body = compilePrd(project, store.items(project.id), []);
    expect(body.content).toContain('需要大屏');
    expect(body.content).toContain('待确认');
    expect(body.sourceIds).toContain(d.id);
  });
});
describe('adversarial methods', () => {
  it('rejects filesystem traversal as a method identifier', () => {
    expect(() => library.get('../../etc/passwd')).toThrow('METHOD_NOT_FOUND');
  });
  it('refuses to finish an unanswered workflow', () => {
    expect(() => workflowBody(library.get('create-prd'), [''], true)).toThrow('WORKFLOW_INCOMPLETE');
  });
  it('rejects answer overflow instead of truncating silently', () => {
    expect(() => workflowBody(library.get('create-prd'), ['x'.repeat(100_001)], false)).toThrow('VALIDATION_FAILED');
  });
  it('does not turn suggested preferences into document requirements', () => {
    const { store, project } = setup();
    const pref = store.createItem(null, 'preference', '偏好', { content: '未经确认的偏好' });
    expect(compilePrd(project, [], [pref]).content).not.toContain('未经确认的偏好');
  });
});
