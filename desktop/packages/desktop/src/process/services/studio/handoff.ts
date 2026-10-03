import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import type { StudioItem, StudioPack } from '../../../common/types/studio';
import { inspectPlan } from '../../../common/studio/blueprint';
import { validateArchive } from './archive';

type FilePack = StudioPack & { files?: Record<string, { extension: string; sha256: string; data: string }> };
const labels: Record<string, string> = {
  missingField: '蓝图字段待补充',
  openQuestions: '开放问题待解决',
  noRequirements: '尚未拆分首版需求',
  missingStory: '需求描述待补充',
  missingNormal: '正常验收待补充',
  missingAdverse: '对抗验收待补充',
  pendingDecision: '决定待确认',
  staleDocument: '文档依据已变化',
};

/** A portable, local-only handoff. Link resolution is restricted to the validated exported project. */
export async function buildHandoff(input: FilePack, artifactId: string): Promise<Buffer> {
  const pack = validateArchive(input);
  const artifact = pack.items.find((i) => i.id === artifactId && i.kind === 'artifact');
  if (!artifact || typeof artifact.body.content !== 'string') throw new Error('NOT_FOUND');
  const zip = new JSZip();
  const manifest: Record<string, string> = {};
  let bytes = 0;
  const add = (name: string, content: string | Buffer): void => {
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    bytes += data.length;
    if (bytes > 160_000_000) throw new Error('EXPORT_TOO_LARGE');
    manifest[name] = createHash('sha256').update(data).digest('hex');
    zip.file(name, data);
  };
  const current = new Map(pack.items.map((i) => [i.id, i]));
  const history = new Map(pack.versions.map((v) => [`${v.itemId}:${v.version}`, v.snapshot]));
  const pending = [artifact];
  const selectedSources = new Map<string, StudioItem>();
  const included = new Set<string>();
  const missing = new Set<string>();
  const path = (item: StudioItem): string => `sources/${item.id}-v${item.version}.md`;
  const source = (id: string, version?: unknown): StudioItem | undefined =>
    typeof version === 'number' ? history.get(`${id}:${version}`) : current.get(id);
  const links = (content: string, owner: StudioItem, prefix = ''): string =>
    content.replace(/origin:\/\/item\/([a-f0-9-]{36})(?:\?version=(\d+))?/g, (_match, id: string, version?: string) => {
      const versions = owner.body.sourceVersions as Record<string, number> | undefined;
      const item = source(id, version ? Number(version) : versions?.[id]);
      if (!item) {
        missing.add(id);
        return '#来源未随包提供';
      }
      pending.push(item);
      return `${prefix}${path(item)}`;
    });
  add(
    'PRD.md',
    `> 导出的是你选择的文档 v${artifact.version}。状态：${artifact.status}。\n\n${links(artifact.body.content, artifact)}`
  );
  while (pending.length) {
    const item = pending.pop()!;
    const key = `${item.id}:${item.version}`;
    if (included.has(key)) continue;
    included.add(key);
    selectedSources.set(key, item);
    const refs = Array.isArray(item.body.sourceIds) ? item.body.sourceIds : [];
    const versions = item.body.sourceVersions as Record<string, number> | undefined;
    for (const id of refs) {
      if (typeof id !== 'string') continue;
      const linked = source(id, versions?.[id]);
      if (linked) pending.push(linked);
      else missing.add(id);
    }
    if (included.size > 20_000) throw new Error('EXPORT_TOO_LARGE');
    let content = `# ${item.title}\n\n类型：${item.kind} · 版本：${item.version} · 状态：${item.status}\n\n`;
    if (item.kind === 'citation') {
      const original = source(String(item.body.sourceId), item.body.sourceVersion);
      if (!original) throw new Error('INVALID_REFERENCE');
      pending.push(original);
      content += `> ${String(item.body.quote)}\n\n[当时引用的原文 v${original.version}](../${path(original)})\n\n`;
    }
    content += links(String(item.body.content ?? ''), item, '../');
    // JSON retains fields that have no prose representation without interpreting them as commands.
    content += `\n\n## 字段快照\n\n\`\`\`json\n${JSON.stringify(item.body, null, 2)}\n\`\`\`\n`;
    add(path(item), content);
    if (item.kind === 'canvas') add(`canvases/${item.id}-v${item.version}.drawnix`, JSON.stringify(item.body, null, 2));
  }
  const requirements = [...selectedSources.values()].filter((i) => i.kind === 'requirement' && i.status !== 'archived');
  add(
    'requirements.md',
    `# 需求与验收\n\n以下为这份文档采用的需求快照；版本依据保存在 sources。\n\n${requirements.map((i) => `## ${String(i.body.requirementId)} · ${i.title}\n\n范围：${i.body.priority === 'later' ? '以后再做' : '第一版'}\n\n${String(i.body.content || '待补充')}\n\n正常验收：${String(i.body.normal || '待补充')}\n\n对抗验收：${String(i.body.adverse || '待补充')}\n\n[字段与来源](${path(i)})`).join('\n\n') || '待补充：首版需求及验收。'}`
  );
  add(
    'acceptance.md',
    `# 实施后的验证清单\n\n每项正常测试之后执行对应的对抗测试，并记录真实结果。这里是测试计划，未勾选不代表执行过。\n\n${requirements
      .filter((i) => i.body.priority !== 'later')
      .map(
        (i) =>
          `## ${String(i.body.requirementId)} · ${i.title}\n\n- [ ] 正常：${String(i.body.normal || '待补充')}\n- [ ] 对抗：${String(i.body.adverse || '待补充')}\n- 实测结果 / 环境 / 日期：待执行`
      )
      .join('\n\n')}`
  );
  for (const [id, file] of Object.entries(input.files ?? {})) {
    const item = [...selectedSources.values()].find((entry) => entry.id === id);
    if (!item) continue;
    const data = Buffer.from(file.data, 'base64');
    if (
      !item ||
      item.kind !== 'material' ||
      !/^\.[a-z0-9]{1,8}$/.test(file.extension) ||
      createHash('sha256').update(data).digest('hex') !== file.sha256 ||
      item.body.fileHash !== file.sha256
    )
      throw new Error('INTEGRITY_FAILED');
    add(`originals/${id}${file.extension}`, data);
  }
  if (
    [...selectedSources.values()].some(
      (item) => item.kind === 'workflow' && typeof item.body.methodContent === 'string'
    )
  )
    add(
      'PM-Skills-LICENSE.txt',
      'MIT License\n\nCopyright (c) 2026 Pawel Huryn\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n'
    );
  const inspection = inspectPlan(pack.project, [...selectedSources.values()]);
  const issues = inspection.gaps.map((g) => `- ${labels[g.code]}：${g.title || g.field || '项目'}`);
  add(
    'open-questions.md',
    `# 交付前需要核对\n\n${issues.join('\n') || '结构字段已齐全，仍需人工验证事实、可行性和真实用户价值。'}\n\n${[...missing].map((id) => `- 来源未随包提供：${id}。接收者需要补充来源后再采用。`).join('\n')}`
  );
  add(
    'README.md',
    `# ${pack.project.title} · 交付包\n\n从 [PRD](PRD.md) 开始，结合 [需求](requirements.md)、[正常与对抗验收](acceptance.md) 和 [待核对事项](open-questions.md) 阅读。\n\n${inspection.ready && artifact.status !== 'possibly_stale' ? '关键结构已填写；不代表事实与可行性已经验证。' : '仍有待补充或待复核内容。这份交付包是讨论草稿，不能当作已验证的开发指令。'}\n\n重新整理不会覆盖你选择的手写 PRD。本包仅包含所选文档和它关联的来源。sources 保存采用的对象与引用历史，canvases 保存可编辑 Drawnix 源文件，originals 保存已导入的原始附件。来源状态和版本写在每个文件开头，建议不能视为已确认决定。所有文件可在工作台之外阅读；画布源文件需 Drawnix 兼容编辑器打开。\n\n此包用于交接，完整项目恢复请使用“导出项目”生成的 .origin.json。模型密钥和聊天账户配置不在本包中。\n\n## 内容索引\n\n${[...selectedSources.values()].map((i) => `- [${i.title}](${path(i)}) · ${i.kind} · ${i.status}`).join('\n')}`
  );
  add(
    'manifest.json',
    JSON.stringify(
      {
        format: 'origin-handoff',
        schema: 1,
        artifact: { id: artifact.id, version: artifact.version },
        files: manifest,
      },
      null,
      2
    )
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
