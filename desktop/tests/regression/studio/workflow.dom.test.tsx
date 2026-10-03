import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { resolve } from 'node:path';
import type { StudioItem, StudioPatch, StudioProject } from '@/common/types/studio';
import { StudioStore } from '@/process/services/studio/store';
import { MethodLibrary, compilePrd, workflowBody } from '@/process/services/studio/methods';
import { DraftContext } from '@/renderer/pages/Studio/common';
import Methods from '@/renderer/pages/Studio/panels/Methods';
import Assets from '@/renderer/pages/Studio/panels/Assets';
import Project from '@/renderer/pages/Studio/Project';
import Home from '@/renderer/pages/Studio/Home';
import Planning from '@/renderer/pages/Studio/panels/Planning';

const backend = vi.hoisted(() => ({
  api: vi.fn(),
  saveItem: vi.fn(),
  createItem: vi.fn(),
  uploadMaterial: vi.fn(),
  request: vi.fn(),
  downloadBlob: vi.fn(),
  downloadText: vi.fn(),
  exportProject: vi.fn(),
}));
vi.mock('@/renderer/pages/Studio/client', () => backend);
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key.replace(/^studio\./, '') }),
}));
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...actual, Message: { ...actual.Message, success: vi.fn(), error: vi.fn() } };
});
vi.mock('@/renderer/pages/Studio/panels/Canvas', () => ({ default: () => null }));
vi.mock('@/renderer/pages/Studio/panels/Review', () => ({ default: () => null }));
vi.mock('@/renderer/pages/Studio/panels/Backups', () => ({ default: () => null }));

const library = new MethodLibrary(resolve(process.cwd(), '../vendor/pm-skills'));
let store: StudioStore;
let project: StudioProject;
const dirtyChanges = vi.fn();
const draftContext = { setDirty: dirtyChanges, guard: (action: () => void) => action() };
const answers = [
  '概述标记：个人访谈记录工具。',
  '负责人标记：自己负责产品设计和开发。',
  '背景标记：目前证据与决定分散在三个工具。',
  '目标标记：访谈整理耗时从30分钟降低到10分钟；十份样本八份达标。',
  '用户标记：每周访谈两次的独立创作者，离线使用Mac。',
  '价值标记：决定可以回到原始证据，减少凭印象写需求。',
  '流程标记：导入录音→转写→挑选证据→形成决定；失败保留原文件。',
  '验收标记：首版只做文本导入和引用；不做多人协作；正常及损坏文件均可恢复。',
];

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  store = new StudioStore(':memory:');
  project = store.createProject('UI 审查项目', '用于隔离验证，不接触实际用户数据。');
  backend.api.mockImplementation(async (path: string, method = 'GET', body?: Record<string, unknown>) => {
    if (path === `/projects/${project.id}/blueprint` && method === 'POST') {
      const current = store.items(project.id, 'blueprint')[0];
      if (body?.version !== (current?.version ?? 0)) throw new Error('VERSION_CONFLICT');
      const fields = {
        ...(current?.body.fields as Record<string, string>),
        ...(body?.fields as Record<string, string>),
      };
      return current
        ? store.updateItem(current.id, current.version, { body: { ...current.body, fields } })
        : store.createItem(project.id, 'blueprint', '产品蓝图', { fields });
    }
    if (path === `/projects/${project.id}/compile` && method === 'POST')
      return store.createItem(project.id, 'artifact', 'PRD', compilePrd(project, store.items(project.id), []));
    if (path === '/methods') return library.list();
    if (path.startsWith('/methods/')) return library.get(path.slice('/methods/'.length));
    const versions = path.match(/^\/items\/([^/]+)\/versions$/);
    if (versions) return store.versions(versions[1]);
    if (path === `/projects/${project.id}/workflows` && method === 'POST') {
      const definition = library.get(String(body?.methodId));
      return store.createItem(project.id, 'workflow', definition.title, workflowBody(definition, [], false));
    }
    const match = path.match(/^\/items\/([^/]+)\/workflow$/);
    if (match && method === 'POST') {
      const current = store.getItem(match[1]);
      const definition = library.get(String(current.body.methodId));
      return store.updateItem(current.id, Number(body?.version), {
        body: workflowBody(definition, body?.answers, body?.complete === true),
      });
    }
    throw new Error(`Unimplemented audit IO: ${method} ${path}`);
  });
  backend.saveItem.mockImplementation(async (item: StudioItem, patch: StudioPatch) =>
    store.updateItem(item.id, item.version, patch)
  );
  backend.createItem.mockImplementation(async (projectId, kind, title, body) =>
    store.createItem(projectId, kind, title, body)
  );
});

describe('F source readability and modal drafts', () => {
  it('F normal preserves the unsaved state of a newly written document', async () => {
    render(
      <DraftContext.Provider value={draftContext}>
        <Assets projectId={project.id} kinds={['artifact']} items={[]} allItems={[]} refresh={async () => undefined} />
      </DraftContext.Provider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'newDocument' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'title' }), { target: { value: '尚未保存的新方案' } });
    expect(dirtyChanges).toHaveBeenLastCalledWith(true);
  });
  it('F adversarial a real generated version link displays decision reasoning without a JSON detour', async () => {
    const d = store.createItem(project.id, 'decision', '采用离线保存', {
      options: ['离线', '云端'],
      selected: '离线',
      reason: '避免敏感访谈上传',
      basis: '用户明确约束',
    });
    store.confirmDecision(d.id, 1);
    store.createItem(project.id, 'artifact', '可追溯PRD', compilePrd(project, store.items(project.id), []));
    render(
      <DraftContext.Provider value={draftContext}>
        <Project
          project={project}
          items={store.items(project.id)}
          preferences={[]}
          refresh={async () => undefined}
          home={() => undefined}
        />
      </DraftContext.Provider>
    );
    fireEvent.click(screen.getByText('documents', { exact: true }));
    fireEvent.click(screen.getByRole('button', { name: /可追溯PRD/ }));
    fireEvent.click(screen.getByRole('button', { name: 'preview' }));
    fireEvent.click(screen.getByRole('button', { name: '采用离线保存', exact: true }));
    await screen.findByText('采用离线保存 · v2');
    expect(screen.getAllByText('避免敏感访谈上传', { exact: true }).length).toBeGreaterThan(0);
  });
});

function PlanningHarness() {
  const [items, setItems] = useState(store.items(project.id));
  return (
    <DraftContext.Provider value={draftContext}>
      <Planning
        project={project}
        items={items}
        refresh={async () => setItems(store.items(project.id))}
        openSource={() => undefined}
      />
    </DraftContext.Provider>
  );
}
describe('E coherent creation path', () => {
  it('E normal records a requirement and includes it in the next generated PRD', async () => {
    render(<PlanningHarness />);
    fireEvent.click(screen.getByText('2. requirements', { exact: true }));
    fireEvent.change(screen.getByRole('textbox', { name: 'title' }), { target: { value: '记录支出' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'requirementFields.content' }), {
      target: { value: '输入金额后保存' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'requirementFields.normal' }), {
      target: { value: '20元保存到列表' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'requirementFields.adverse' }), {
      target: { value: '非法金额保留输入' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'save', exact: true }));
    await waitFor(() => expect(store.items(project.id, 'requirement')).toHaveLength(1));
    fireEvent.click(screen.getByText('3. handoff', { exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'compile', exact: true }));
    await waitFor(() => expect(store.items(project.id, 'artifact')[0]?.body.content).toContain('FR-001'));
    expect(store.items(project.id, 'artifact')[0].body.content).toContain('非法金额保留输入');
  });
  it('E adversarial a blueprint save failure retains the answer and warns before leaving', async () => {
    backend.api.mockRejectedValueOnce(new Error('VERSION_CONFLICT'));
    render(<PlanningHarness />);
    const editor = screen.getByRole('textbox', { name: 'blueprintFields.problem' });
    fireEvent.change(editor, { target: { value: '刚访谈得到的真实困难' } });
    fireEvent.click(screen.getByRole('button', { name: 'saveAndContinue' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'saveAndContinue' })).not.toHaveClass('arco-btn-loading')
    );
    expect(editor).toHaveValue('刚访谈得到的真实困难');
    expect(dirtyChanges).toHaveBeenLastCalledWith(true);
    expect(store.items(project.id, 'blueprint')).toHaveLength(0);
  });
});

describe('D capture draft survival', () => {
  it('D normal restores the original thought after the home screen remounts', () => {
    const props = { projects: [], refresh: async () => undefined, open: () => undefined };
    const mounted = render(<Home {...props} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'capture' }), { target: { value: '尚未整理的原话' } });
    mounted.unmount();
    render(<Home {...props} />);
    expect(screen.getByRole('textbox', { name: 'capture' })).toHaveValue('尚未整理的原话');
  });
  it('D adversarial a slow capture does not clear the next thought', async () => {
    const gate = deferred();
    backend.createItem.mockImplementation(async () => {
      await gate.promise;
      return {};
    });
    render(<Home projects={[]} refresh={async () => undefined} open={() => undefined} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'capture' }), { target: { value: '第一条' } });
    fireEvent.click(screen.getByRole('button', { name: 'capture', exact: true }));
    fireEvent.change(screen.getByRole('textbox', { name: 'capture' }), { target: { value: '第二条不能丢' } });
    await act(async () => gate.release());
    expect(screen.getByRole('textbox', { name: 'capture' })).toHaveValue('第二条不能丢');
    cleanup();
    render(<Home projects={[]} refresh={async () => undefined} open={() => undefined} />);
    expect(screen.getByRole('textbox', { name: 'capture' })).toHaveValue('第二条不能丢');
  });
});
afterEach(() => {
  cleanup();
  store.close();
});

function MethodsHarness() {
  const [items, setItems] = useState<StudioItem[]>([]);
  return (
    <DraftContext.Provider value={draftContext}>
      <Methods projectId={project.id} items={items} refresh={async () => setItems(store.items(project.id))} />
    </DraftContext.Provider>
  );
}
async function completePrdInUi(): Promise<StudioItem> {
  render(<MethodsHarness />);
  fireEvent.click(await screen.findByRole('button', { name: /撰写产品需求文档/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'startMethod' }));
  await screen.findByRole('textbox', { name: 'answer' });
  for (let step = 0; step < answers.length; step += 1) {
    fireEvent.change(screen.getByRole('textbox', { name: 'answer' }), { target: { value: answers[step] } });
    if (step < answers.length - 1) fireEvent.click(screen.getByRole('button', { name: 'next' }));
  }
  fireEvent.click(screen.getByRole('button', { name: 'finishMethod' }));
  await waitFor(() => expect(store.items(project.id, 'workflow')[0]?.body.complete).toBe(true));
  return store.items(project.id, 'workflow')[0];
}
function section(content: string, number: number): string {
  return content.split(`\n## ${number}. `)[1]?.split('\n## ')[0] ?? '';
}

describe('A completed PRD method', () => {
  it('A normal persists all eight UI answers and includes their pinned method output', async () => {
    const workflow = await completePrdInUi();
    const compiled = compilePrd(project, store.items(project.id), []);
    expect(workflow.body.answers).toEqual(answers);
    expect(workflow.body.methodVersion).toBe(library.get('create-prd').version);
    expect(String(compiled.content).split('## 附录：方法成果')[1]).toContain(answers[7]);
  });
  it('A adversarial supplied goals users and acceptance belong in the relevant PRD body sections', async () => {
    const workflow = await completePrdInUi();
    const compiled = String(compilePrd(project, store.items(project.id), []).content);
    const actual = {
      complete: workflow.body.complete,
      goals: section(compiled, 4),
      users: section(compiled, 5),
      acceptance: section(compiled, 8),
    };
    console.log('AUDIT_A_ACTUAL', JSON.stringify(actual));
    expect.soft(actual.goals).toContain(answers[3]);
    expect.soft(actual.users).toContain(answers[4]);
    expect.soft(actual.acceptance).toContain(answers[7]);
  });
});

function linkProject(target: 'material' | 'workflow'): { targetItem: StudioItem; artifact: StudioItem } {
  const material = store.createItem(project.id, 'material', '资料目标', { content: '唯一资料正文，供正常链接控制。' });
  const definition = library.get('pre-mortem');
  store.createItem(
    project.id,
    'workflow',
    '方法流程甲',
    workflowBody(
      definition,
      definition.steps.map(() => '甲答案'),
      true
    )
  );
  const workflow = store.createItem(
    project.id,
    'workflow',
    '方法流程乙目标',
    workflowBody(
      definition,
      definition.steps.map(() => '乙目标答案'),
      true
    )
  );
  const targetItem = target === 'material' ? material : workflow;
  const artifact = store.createItem(project.id, 'artifact', 'PRD 跳转复现', {
    content: `# 跳转检查\n\n[查看指定来源](origin://item/${targetItem.id})`,
    sourceIds: [targetItem.id],
  });
  return { targetItem, artifact };
}
async function clickPrdSource(target: 'material' | 'workflow'): Promise<StudioItem> {
  const { targetItem } = linkProject(target);
  render(
    <DraftContext.Provider value={draftContext}>
      <Project
        project={project}
        items={store.items(project.id)}
        preferences={[]}
        refresh={async () => undefined}
        home={() => undefined}
      />
    </DraftContext.Provider>
  );
  fireEvent.click(screen.getByText('documents', { exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: /PRD 跳转复现/ }));
  fireEvent.click(screen.getByRole('button', { name: 'preview' }));
  fireEvent.click(screen.getByRole('button', { name: '查看指定来源' }));
  return targetItem;
}
describe('B source-link navigation', () => {
  it('B normal opens and focuses the linked material detail', async () => {
    await clickPrdSource('material');
    expect(await screen.findByRole('heading', { name: '资料目标' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'quoteParagraph' })).toBeInTheDocument();
  });
  it('B adversarial workflow source opens the specific saved workflow rather than an unselected library', async () => {
    const target = await clickPrdSource('workflow');
    await screen.findByRole('button', { name: /方法流程乙目标/ });
    await screen.findByRole('button', { name: /撰写产品需求文档/ });
    const answer = screen.queryByRole('textbox', { name: 'answer' }) as HTMLTextAreaElement | null;
    const actual = {
      expectedWorkflowId: target.id,
      headingVisible: Boolean(screen.queryByRole('heading', { name: target.title })),
      answer: answer?.value ?? null,
      emptyHintVisible: Boolean(screen.queryByText('selectedEmpty')),
    };
    console.log('AUDIT_B_ACTUAL', JSON.stringify(actual));
    expect.soft(actual.headingVisible).toBe(true);
    expect.soft(actual.answer).toBe('乙目标答案');
  });
});

function EditingHarness({ initial }: { initial: StudioItem }) {
  const [item, setItem] = useState(initial);
  return (
    <DraftContext.Provider value={draftContext}>
      <Assets
        projectId={project.id}
        kinds={['artifact']}
        items={[item]}
        allItems={[item]}
        refresh={async () => setItem(store.getItem(initial.id))}
      />
    </DraftContext.Provider>
  );
}
function deferred() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolvePromise) => {
    release = resolvePromise;
  });
  return { promise, release };
}
async function prepareDelayedSave(): Promise<{ release: () => void; item: StudioItem }> {
  const item = store.createItem(project.id, 'artifact', '编辑竞态复现', { content: '原始内容', sourceIds: [] });
  const gate = deferred();
  backend.saveItem.mockImplementation(async (base: StudioItem, patch: StudioPatch) => {
    const sent = structuredClone(patch);
    await gate.promise;
    return store.updateItem(base.id, base.version, sent);
  });
  render(<EditingHarness initial={item} />);
  fireEvent.click(screen.getByRole('button', { name: /编辑竞态复现/ }));
  fireEvent.change(screen.getByRole('textbox', { name: 'content' }), { target: { value: '已提交快照' } });
  fireEvent.click(screen.getByRole('button', { name: 'save', exact: true }));
  await waitFor(() => expect(backend.saveItem).toHaveBeenCalledTimes(1));
  return { release: gate.release, item };
}
describe('C explicit save under latency', () => {
  it('C normal keeps the saved snapshot when no newer edits exist', async () => {
    const { release, item } = await prepareDelayedSave();
    await act(async () => release());
    await waitFor(() => expect(store.getItem(item.id).version).toBe(2));
    expect(screen.getByRole('textbox', { name: 'content' })).toHaveValue('已提交快照');
    expect(dirtyChanges).toHaveBeenLastCalledWith(false);
  });
  it('C adversarial newer text typed during save remains visible and dirty after the old response', async () => {
    const { release, item } = await prepareDelayedSave();
    const editor = screen.getByRole('textbox', { name: 'content' });
    fireEvent.change(editor, { target: { value: '已提交快照\n继续输入的新草稿，尚未提交' } });
    expect(editor).toHaveValue('已提交快照\n继续输入的新草稿，尚未提交');
    await act(async () => release());
    await waitFor(() => expect(store.getItem(item.id).version).toBe(2));
    console.log(
      'AUDIT_C_ACTUAL',
      JSON.stringify({
        persisted: store.getItem(item.id).body.content,
        rendered: (editor as HTMLTextAreaElement).value,
        dirty: dirtyChanges.mock.calls.at(-1)?.[0],
        saveDisabled: screen.getByRole('button', { name: 'save', exact: true }).hasAttribute('disabled'),
      })
    );
    expect.soft(editor).toHaveValue('已提交快照\n继续输入的新草稿，尚未提交');
    expect.soft(dirtyChanges).toHaveBeenLastCalledWith(true);
    expect.soft(screen.getByRole('button', { name: 'save', exact: true })).toBeEnabled();
  });
});
