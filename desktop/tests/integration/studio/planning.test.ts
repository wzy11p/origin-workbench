import { afterEach, describe, expect, it } from 'vitest';
import { StudioStore } from '../../../packages/desktop/src/process/services/studio/store';
import { compilePrd } from '../../../packages/desktop/src/process/services/studio/methods';
import { resolveBlueprint, inspectPlan } from '../../../packages/desktop/src/common/studio/blueprint';
import { buildHandoff } from '../../../packages/desktop/src/process/services/studio/handoff';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';

const stores: StudioStore[] = [];
const setup = () => {
  const store = new StudioStore(':memory:');
  stores.push(store);
  const project = store.createProject('个人记账', '快速知道钱花到哪里');
  return { store, project };
};
afterEach(() => stores.splice(0).forEach((s) => s.close()));
const answers = [
  '离线记账工具',
  '自己负责',
  '支出零散，月底记不清',
  '一笔录入不超过20秒',
  '每天有小额支出的我，使用Mac',
  '看到每月分类合计',
  '录入金额→保存→按月查看；非法金额保留输入',
  '首版手动录入和月汇总；不做银行同步',
];

describe('normal planning', () => {
  it('exports a readable handoff with the selected PRD and historical citation text', async () => {
    const { store, project } = setup();
    const material = store.createItem(project.id, 'material', '访谈原文', { content: '每周需要整理两次' });
    const quote = store.createItem(project.id, 'citation', '频率依据', { sourceId: material.id, quote: '整理两次' });
    const doc = store.createItem(project.id, 'artifact', '交付PRD', compilePrd(project, store.items(project.id), []));
    store.updateItem(material.id, 1, { body: { content: '现在整理一次' } });
    const zip = await JSZip.loadAsync(await buildHandoff(store.exportProject(project.id), doc.id));
    const prd = await zip.file('PRD.md')!.async('string');
    expect(prd).not.toContain('origin://');
    expect(prd).toContain(`来源：[原文](sources/${material.id}-v1.md) · 版本 1`);
    expect(await zip.file(`sources/${material.id}-v1.md`)!.async('string')).toContain('每周需要整理两次');
    expect(await zip.file(`sources/${quote.id}-v1.md`)!.async('string')).toContain('整理两次');
  });
  it('reuses method answers in the blueprint and the matching PRD sections', () => {
    const { store, project } = setup();
    const method = store.createItem(project.id, 'workflow', '我的PRD方法', {
      methodId: 'create-prd',
      answers,
      complete: true,
      content: answers.join('\n'),
    });
    const view = resolveBlueprint(project, store.items(project.id));
    const doc = compilePrd(project, store.items(project.id), []);
    expect(view.fields.success.value).toBe(answers[3]);
    expect(view.fields.success.source).toEqual({ id: method.id, version: 1 });
    expect(String(doc.content).split('## 4. ')[1]?.split('## 5.')[0]).toContain(answers[3]);
  });
  it('gives each requirement a stable number across edits and archive', () => {
    const { store, project } = setup();
    const one = store.createItem(project.id, 'requirement', '手动记账', {
      content: '输入金额后保存',
      normal: '20元保存并出现',
      adverse: '负数拒绝且保留输入',
      priority: 'first',
    });
    const updated = store.updateItem(one.id, 1, { title: '快速手动记账', status: 'archived' });
    const two = store.createItem(project.id, 'requirement', '按月汇总', {
      content: '',
      normal: '',
      adverse: '',
      priority: 'first',
    });
    expect(updated.body.requirementId).toBe('FR-001');
    expect(two.body.requirementId).toBe('FR-002');
  });
});
describe('adversarial planning', () => {
  it('rejects duplicate requirement identifiers in a re-signed import', () => {
    const { store, project } = setup();
    store.createItem(project.id, 'requirement', '第一项', { content: '', normal: '', adverse: '', priority: 'first' });
    store.createItem(project.id, 'requirement', '第二项', { content: '', normal: '', adverse: '', priority: 'first' });
    const pack = store.exportProject(project.id);
    for (const item of pack.items) item.body.requirementId = 'FR-001';
    for (const entry of pack.versions) entry.snapshot.body.requirementId = 'FR-001';
    const { checksum: _checksum, ...payload } = pack;
    pack.checksum = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    expect(() => store.importProject(pack)).toThrow('INVALID_PACKAGE');
    expect(store.projects()).toHaveLength(1);
  });
  it('leaves unrelated private project material out of the chosen document handoff', async () => {
    const { store, project } = setup();
    const privateNote = store.createItem(project.id, 'material', '私人资料', { content: '不用于这个交付的私密笔记' });
    const doc = store.createItem(project.id, 'artifact', '公开说明', { content: '要交付的正文' });
    const zip = await JSZip.loadAsync(await buildHandoff(store.exportProject(project.id), doc.id));
    expect(zip.file(`sources/${privateNote.id}-v1.md`)).toBeNull();
    expect(await zip.file('README.md')!.async('string')).not.toContain('私人资料');
  });
  it('never fetches an external project via a hand-written source link', async () => {
    const { store, project } = setup();
    const foreign = store.createProject('另外一个项目', '保密');
    const secret = store.createItem(foreign.id, 'material', '私密', { content: '不应出现在交付包' });
    const doc = store.createItem(project.id, 'artifact', '手写PRD', {
      content: `查看 [来源](origin://item/${secret.id})`,
    });
    const zip = await JSZip.loadAsync(await buildHandoff(store.exportProject(project.id), doc.id));
    expect(zip.file(`sources/${secret.id}-v1.md`)).toBeNull();
    expect(await zip.file('PRD.md')!.async('string')).toContain('来源未随包提供');
    expect(await zip.file('README.md')!.async('string')).toContain('待补充');
  });
  it('preserves a manual field when a newer method suggests something else', () => {
    const { store, project } = setup();
    store.createItem(project.id, 'blueprint', '蓝图', { fields: { success: '10笔记录全部在20秒内完成' } });
    store.createItem(project.id, 'workflow', '后来填的方法', { methodId: 'create-prd', answers, complete: true });
    expect(resolveBlueprint(project, store.items(project.id)).fields.success.value).toBe('10笔记录全部在20秒内完成');
  });
  it('keeps unknown fields visible and refuses to label a template ready', () => {
    const { store, project } = setup();
    store.createItem(project.id, 'blueprint', '蓝图', {
      fields: { success: '待补充', audience: '不知道', problem: '   ' },
    });
    const report = inspectPlan(project, store.items(project.id));
    expect(report.ready).toBe(false);
    expect(report.gaps.map((g) => g.field)).toEqual(expect.arrayContaining(['success', 'audience', 'problem']));
  });
  it('points to the exact requirement missing an adverse acceptance case', () => {
    const { store, project } = setup();
    const req = store.createItem(project.id, 'requirement', '保存记录', {
      content: '保存金额',
      normal: '正常保存',
      adverse: '',
      priority: 'first',
    });
    expect(inspectPlan(project, store.items(project.id)).gaps).toContainEqual(
      expect.objectContaining({ itemId: req.id, code: 'missingAdverse' })
    );
  });
  it('rejects a forged requirement number and an invented validation outcome', () => {
    const { store, project } = setup();
    const req = store.createItem(project.id, 'requirement', '保存', {
      content: '',
      normal: '',
      adverse: '',
      priority: 'first',
    });
    expect(() => store.updateItem(req.id, 1, { body: { ...req.body, requirementId: 'FR-999' } })).toThrow(
      'ORIGINAL_IMMUTABLE'
    );
    expect(() =>
      store.createItem(project.id, 'validation', '实验', {
        hypothesis: '',
        method: '',
        threshold: '',
        result: '',
        outcome: 'guaranteed',
      })
    ).toThrow('VALIDATION_FAILED');
  });
});
