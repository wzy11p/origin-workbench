import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StudioBody, StudioItem, StudioMethod, StudioProject } from '../../../common/types/studio';
import { effectivePreferences } from '../../../common/studio/preferences';
import { resolveBlueprint, inspectPlan, type BlueprintField } from '../../../common/studio/blueprint';

const CURATED: Record<string, { title: string; description: string; questions: string[] }> = {
  discover: {
    title: '从想法到验证计划',
    description: '发散方案、选择方向、识别假设，再设计低成本实验。',
    questions: [
      '这是新产品还是已有产品？要弄清什么问题，已有资料是什么？',
      '分别从产品、设计和工程角度提出方案，保留不同可能。',
      '由你选择三到五个值得继续的方案，并记录选择理由。',
      '列出价值、易用性、可行性、持续投入和触达用户方面的假设。',
      '按影响与不确定性排序，由你确认优先验证的假设。',
      '为优先假设设计实验：操作、指标、通过阈值、成本和期限。',
      '整理验证计划：什么结果会继续、调整或停止这个方向？',
    ],
  },
  'competitor-analysis': {
    title: '竞品与差异化分析',
    description: '记录可核验的竞品事实，找到适合自己的差异化方向。',
    questions: [
      '市场、用户与使用场景边界是什么？',
      '选择最多五个直接竞品，附上资料、链接与核验日期。',
      '比较定位、功能、价格、渠道与使用门槛；未知内容保留待查。',
      '各产品的优势和缺口有什么证据？区分观察与推测。',
      '哪些用户任务仍未被满足？自己可以在哪些方面做出差异？',
      '决定重点方向、要避开的领域和下一步验证方式。',
    ],
  },
  'identify-assumptions-new': {
    title: '关键假设与验证',
    description: '从八类风险识别假设，明确什么证据会改变判断。',
    questions: [
      '描述产品概念、目标人群和当前最重要的功能。',
      '从产品、设计、工程三个角度设想它会因为什么失败。',
      '列出价值、易用性、商业可持续性、技术可行性四类假设。',
      '补充伦理、触达市场、战略目标与团队能力四类假设。',
      '逐项标记证据、信心、影响和不确定性；选出最危险的一项。',
      '为它设计实验，写明指标、阈值、期限及支持或推翻后的行动。',
    ],
  },
  'test-scenarios': {
    title: '正常与对抗测试场景',
    description: '把用户故事转成可执行步骤，并检查错误输入和失败恢复。',
    questions: [
      '要验证哪个用户故事？验收条件是什么？',
      '测试前需要什么系统状态、数据与配置？',
      '由谁执行，权限与入口是什么？',
      '写出正常路径，每步附可观察的预期结果。',
      '紧跟正常路径设计对抗测试：空值、非法输入、冲突、中断与越界。',
      '明确恢复步骤、通过标准和失败后必须保留的数据。',
    ],
  },
  'opportunity-solution-tree': {
    title: '机会与方案树',
    description: '从期望结果出发，把用户机会、多个方案与验证实验连起来。',
    questions: [
      '想改善的一个可衡量结果是什么？',
      '资料里出现了哪些真实困难？请附上原话或引用。',
      '哪两个机会最值得先解决？为什么？',
      '为每个机会提出至少三个方案。',
      '如何用低成本实验验证？写出指标与通过阈值。',
      '将结果、机会、方案和实验整理为分层结构。',
    ],
  },
  'create-prd': {
    title: '撰写产品需求文档',
    description: '按 PM Skills 的八节模板，形成可交付的产品说明。',
    questions: [
      '用两三句话说明要做什么。',
      '谁负责这个项目？有哪些协作者？',
      '问题的背景是什么？为什么现在做？',
      '目标与可衡量的成功标准是什么？',
      '为谁解决什么任务？有哪些约束？',
      '用户得到什么价值？当前替代方案有什么不足？',
      '描述核心流程、功能、异常情况与待验证假设。',
      '第一版包含什么？以后再做什么？验收条件是什么？',
    ],
  },
  'pre-mortem': {
    title: '失败预演',
    description: '假设产品已经失败，找出真正的风险和需要先做的行动。',
    questions: [
      '假设发布后失败了，发生了什么？',
      '哪些是真实风险？列出证据或推理。',
      '哪些担忧可能被夸大？为什么？',
      '有哪些没有被充分讨论的不确定性？',
      '区分发布阻断、尽快跟进与持续观察的风险。',
      '为阻断风险写下行动、负责人和完成条件。',
    ],
  },
};

/** Read pinned, local PM Skills files; identifiers never become filesystem paths. */
export class MethodLibrary {
  private methods = new Map<string, StudioMethod>();
  constructor(root: string) {
    for (const plugin of readdirSync(root, { withFileTypes: true })) {
      if (!plugin.isDirectory() || !plugin.name.startsWith('pm-')) continue;
      let skills: string[];
      try {
        skills = readdirSync(join(root, plugin.name, 'skills'));
      } catch {
        continue;
      }
      for (const id of skills) {
        if (!/^[a-z0-9-]+$/.test(id)) continue;
        let content: string;
        try {
          content = readFileSync(join(root, plugin.name, 'skills', id, 'SKILL.md'), 'utf8');
        } catch {
          continue;
        }
        const curated = CURATED[id];
        const description = curated?.description ?? content.match(/^description:\s*"?(.+?)"?\r?$/m)?.[1] ?? id;
        const questions = curated?.questions ?? [
          '这次需要解决什么问题？写出具体场景与已知事实。',
          '依据下方方法原文完成分析。区分事实、假设与建议。',
          '最后采取什么行动？如何验证结果？',
        ];
        this.methods.set(id, {
          id,
          title: curated?.title ?? content.match(/^#{1,2}\s+(.+)$/m)?.[1] ?? id,
          description,
          source: `${plugin.name}/skills/${id}/SKILL.md`,
          version: createHash('sha256').update(content).digest('hex'),
          steps: questions.map((question, i) => ({ title: `${i + 1}`, question, hint: '' })),
          content,
        });
      }
    }
    const source = 'pm-product-discovery/commands/discover.md';
    const content = readFileSync(join(root, source), 'utf8');
    const curated = CURATED.discover;
    this.methods.set('discover', {
      id: 'discover',
      title: curated.title,
      description: curated.description,
      source,
      content,
      version: createHash('sha256').update(content).digest('hex'),
      steps: curated.questions.map((question, i) => ({ title: String(i + 1), question, hint: '' })),
    });
  }
  list(): StudioMethod[] {
    return [...this.methods.values()]
      .sort((a, b) => Number(Boolean(CURATED[b.id])) - Number(Boolean(CURATED[a.id])) || a.title.localeCompare(b.title))
      .map((m) => ({ ...m, content: '' }));
  }
  get(id: string): StudioMethod {
    const method = this.methods.get(id);
    if (!method) throw new Error('METHOD_NOT_FOUND');
    return method;
  }
}

export function workflowBody(method: StudioMethod, answers: unknown, complete: boolean): StudioBody {
  if (
    !Array.isArray(answers) ||
    answers.length > method.steps.length ||
    answers.some((a) => typeof a !== 'string' || a.length > 100_000)
  )
    throw new Error('VALIDATION_FAILED');
  if (complete && (answers.length !== method.steps.length || answers.some((a) => !a.trim())))
    throw new Error('WORKFLOW_INCOMPLETE');
  const normalized = method.steps.map((_s, i) => answers[i] ?? '') as string[];
  return {
    methodId: method.id,
    methodVersion: method.version,
    methodSource: method.source,
    methodContent: method.content,
    steps: method.steps,
    answers: normalized,
    complete,
    content: method.steps.map((s, i) => `## ${s.question}\n\n${normalized[i] || '待补充'}`).join('\n\n'),
  };
}

/** Deterministic compilation: missing facts stay visible and never become invented claims. */
export function compilePrd(project: StudioProject, items: StudioItem[], preferences: StudioItem[]): StudioBody {
  const active = items.filter((i) => !['archived', 'deprecated', 'ignored', 'rejected'].includes(i.status));
  const decisions = active.filter((i) => i.kind === 'decision' && i.status === 'decided');
  const drafts = active.filter((i) => i.kind === 'decision' && i.status !== 'decided');
  const citations = active.filter((i) => i.kind === 'citation');
  const workflows = active.filter((i) => i.kind === 'workflow' && i.body.complete === true);
  const insights = active.filter((i) => ['insight', 'assumption'].includes(i.kind));
  const captures = active.filter((i) => i.kind === 'capture');
  const prefs = effectivePreferences(preferences, project.id).active;
  const blueprint = resolveBlueprint(project, items);
  const requirements = active.filter((i) => i.kind === 'requirement');
  const validations = active.filter((i) => i.kind === 'validation');
  const canvases = active.filter((i) => i.kind === 'canvas');
  const usedMethods = Object.values(blueprint.fields).flatMap((field) =>
    field.source ? active.filter((i) => i.id === field.source?.id) : []
  );
  const linked = [
    ...new Map(
      [
        ...decisions,
        ...drafts,
        ...citations,
        ...workflows,
        ...insights,
        ...captures,
        ...prefs,
        ...usedMethods,
        ...requirements,
        ...validations,
        ...canvases,
        ...(blueprint.item ? [blueprint.item] : []),
      ].map((i) => [i.id, i])
    ).values(),
  ];
  const ref = (item: StudioItem): string => `[${item.title}](origin://item/${item.id}?version=${item.version})`;
  const field = (key: BlueprintField, fallback: string): string => {
    const value = blueprint.fields[key];
    const source = linked.find((i) => i.id === value.source?.id);
    return `${value.value || fallback}${source ? `\n\n来源：${ref(source)} · 版本 ${value.source?.version}` : ''}`;
  };
  const inspection = inspectPlan(project, items);
  const sections = [
    `# ${project.title} · 产品需求文档\n\n> 根据当前项目资料整理。空缺保留为待补充；发布前请逐项核对。`,
    `## 1. 概述\n\n${field('summary', '待补充：项目要解决的问题。')}`,
    `## 2. 负责人\n\n${field('owner', '项目所有者：我。协作方式：待补充。')}`,
    `## 3. 背景与原始想法\n\n${field('problem', '待补充：问题与背景。')}\n\n${captures.map((i) => `### ${ref(i)}\n\n${String(i.body.content ?? '')}`).join('\n\n')}`,
    `## 4. 目标与成功标准\n\n${field('success', '待补充：目标行为、衡量指标、基线与通过阈值。')}`,
    `## 5. 用户与场景\n\n${field('audience', '待补充：目标用户、触发场景与当前做法。')}\n\n### 使用约束\n\n${field('constraints', '待补充：平台、离线、隐私、时间与成本限制。')}`,
    `## 6. 证据与价值\n\n${citations.map((i) => `- ${ref(i)}：${String(i.body.quote ?? '')}\n  来源：[原文](origin://item/${String(i.body.sourceId)}?version=${String(i.body.sourceVersion)}) · 版本 ${String(i.body.sourceVersion)}`).join('\n\n') || '待补充：选取资料原文，建立可追溯的引用。'}\n\n${insights.map((i) => `### ${ref(i)}（${i.kind === 'assumption' ? '待验证假设' : i.status === 'confirmed' ? '已确认观察' : '观察草稿'}）\n\n${String(i.body.content ?? '')}`).join('\n\n')}`,
    `## 7. 方案与决策\n\n${field('flow', '待补充：核心操作流程。')}\n\n### 产品价值\n\n${field('value', '待补充：给用户带来的价值。')}\n\n${decisions.map((i) => `### ${ref(i)}\n\n选择：${String(i.body.selected)}\n\n理由：${String(i.body.reason)}\n\n依据：${String(i.body.basis)}\n\n其他方案：${(i.body.options as string[]).filter((o) => o !== i.body.selected).join('、')}`).join('\n\n') || '待补充：比较方案并确认决策。'}\n\n### 待确认\n\n${drafts.map((i) => `- ${ref(i)}：尚未成为项目决定。`).join('\n') || '暂无待确认决策。'}\n\n### 流程图与草图\n\n${canvases.map((i) => `- ${ref(i)}`).join('\n') || '暂无。'}`,
    `### 已确认的个人偏好\n\n${prefs.map((i) => `- ${i.title}：${String(i.body.content ?? '')}`).join('\n') || '暂无。'}`,
    `## 8. 发布与验收\n\n### 第一版范围\n\n${field('scope', '待补充：第一版包含什么。')}\n\n### 明确不做\n\n${field('outOfScope', '待补充：第一版暂时不做什么。')}\n\n${requirements.map((i) => `### ${String(i.body.requirementId)} · ${ref(i)}（${i.body.priority === 'later' ? '以后再做' : '第一版'}）\n\n${String(i.body.content || '待补充：需求描述。')}\n\n正常验收：${String(i.body.normal || '待补充')}\n\n对抗验收：${String(i.body.adverse || '待补充')}`).join('\n\n') || '待补充：拆分需求，并给每项需求填写正常与对抗验收。'}\n\n### 开放问题\n\n${field('openQuestions', '暂无记录，请人工核对。')}\n\n### 验证记录\n\n${validations.map((i) => `- ${ref(i)}：${String(i.body.hypothesis || '')}\n  通过条件：${String(i.body.threshold || '待补充')}\n  结果：${String(i.body.result || '尚未执行')}\n  结论：${String(i.body.conclusion || '待验证')}`).join('\n') || '尚未验证。'}\n\n> 结构检查：${inspection.ready ? '已填写关键字段和首版验收，仍需人工判断可行性与事实。' : `还有 ${inspection.gaps.length} 项待核对。当前版本不代表已经可以开发。`}`,
    `## 附录：方法成果\n\n${workflows.map((i) => `### ${ref(i)}\n\n${String(i.body.content ?? '')}\n\n方法来源：PM Skills / ${String(i.body.methodId)}`).join('\n\n') || '尚未完成方法流程。'}`,
  ];
  return {
    content: sections.join('\n\n'),
    sourceIds: linked.map((i) => i.id),
    sourceVersions: Object.fromEntries(linked.map((i) => [i.id, i.version])),
    preferenceSnapshot: prefs.map((i) => ({
      id: i.id,
      key: i.body.key,
      scope: i.projectId === null ? 'global' : 'project',
      title: i.title,
      content: i.body.content,
      version: i.version,
    })),
    projectSnapshot: { title: project.title, intent: project.intent },
    compiler: 'origin-blueprint-prd-v2',
    inspection,
    language: 'zh-CN',
  };
}
