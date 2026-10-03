import type { StudioBody, StudioItem, StudioKind, StudioProject } from '../types/studio';

export const BLUEPRINT_FIELDS = [
  'summary',
  'problem',
  'audience',
  'success',
  'constraints',
  'scope',
  'outOfScope',
  'flow',
  'value',
  'owner',
  'openQuestions',
] as const;
export type BlueprintField = (typeof BLUEPRINT_FIELDS)[number];
export type FieldValue = {
  value: string;
  origin: 'manual' | 'method' | 'project' | 'empty';
  source?: { id: string; version: number };
};
export type BlueprintView = { item?: StudioItem; fields: Record<BlueprintField, FieldValue> };
export type PlanGap = {
  code:
    | 'missingField'
    | 'openQuestions'
    | 'noRequirements'
    | 'missingStory'
    | 'missingNormal'
    | 'missingAdverse'
    | 'pendingDecision'
    | 'staleDocument';
  field?: BlueprintField;
  itemId?: string;
  title?: string;
};
export type PlanInspection = { ready: boolean; gaps: PlanGap[]; nextField?: BlueprintField; requirementCount: number };
export const activeItem = (item: StudioItem): boolean =>
  !['archived', 'deprecated', 'ignored', 'rejected'].includes(item.status);
export const concreteText = (value: unknown): boolean =>
  typeof value === 'string' &&
  Boolean(value.trim()) &&
  !/^(待补充|待确认|不知道|不确定|稍后|tbd|todo|unknown)([\s：:，,。.!！?？]|$)/i.test(value.trim());
const object = (value: unknown): value is StudioBody =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Derive suggestions on read. A saved human field, including an intentional blank, always wins. */
export function resolveBlueprint(project: StudioProject, items: StudioItem[]): BlueprintView {
  const active = items.filter(activeItem).toSorted((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id));
  const item = active.find((i) => i.kind === 'blueprint');
  const fields = Object.fromEntries(
    BLUEPRINT_FIELDS.map((key) => [key, { value: '', origin: 'empty' }])
  ) as BlueprintView['fields'];
  fields.summary = { value: project.intent, origin: 'project' };
  const mapping: Partial<Record<BlueprintField, number>> = {
    summary: 0,
    owner: 1,
    problem: 2,
    success: 3,
    audience: 4,
    value: 5,
    flow: 6,
    scope: 7,
  };
  for (const [key, index] of Object.entries(mapping) as [BlueprintField, number][]) {
    const workflow = active.find(
      (i) =>
        i.kind === 'workflow' &&
        i.body.methodId === 'create-prd' &&
        Array.isArray(i.body.answers) &&
        typeof i.body.answers[index] === 'string' &&
        i.body.answers[index].trim()
    );
    if (workflow)
      fields[key] = {
        value: (workflow.body.answers as string[])[index],
        origin: 'method',
        source: { id: workflow.id, version: workflow.version },
      };
  }
  const manual = object(item?.body.fields) ? item.body.fields : {};
  for (const key of BLUEPRINT_FIELDS)
    if (typeof manual[key] === 'string')
      fields[key] = {
        value: manual[key],
        origin: 'manual',
        source: item ? { id: item.id, version: item.version } : undefined,
      };
  return { item, fields };
}

/** Structural completeness only; neither correctness nor feasibility is inferred from a filled field. */
export function inspectPlan(project: StudioProject, items: StudioItem[]): PlanInspection {
  const blueprint = resolveBlueprint(project, items);
  const required: BlueprintField[] = ['problem', 'audience', 'success', 'scope', 'outOfScope', 'constraints', 'flow'];
  const gaps: PlanGap[] = required
    .filter((key) => !concreteText(blueprint.fields[key].value))
    .map((field) => ({ code: 'missingField', field }));
  if (
    blueprint.fields.openQuestions.value.trim() &&
    !/^(无|暂无|none)[。.]?$/i.test(blueprint.fields.openQuestions.value.trim())
  )
    gaps.push({ code: 'openQuestions', field: 'openQuestions' });
  const active = items.filter(activeItem);
  const requirements = active.filter((i) => i.kind === 'requirement' && i.body.priority !== 'later');
  if (!requirements.length) gaps.push({ code: 'noRequirements' });
  for (const r of requirements) {
    for (const [key, code] of [
      ['content', 'missingStory'],
      ['normal', 'missingNormal'],
      ['adverse', 'missingAdverse'],
    ] as const)
      if (!concreteText(r.body[key]))
        gaps.push({ code, itemId: r.id, title: `${String(r.body.requirementId)} · ${r.title}` });
  }
  for (const item of active) {
    if (item.kind === 'decision' && item.status !== 'decided')
      gaps.push({ code: 'pendingDecision', itemId: item.id, title: item.title });
  }
  const latest = active.filter((i) => i.kind === 'artifact').toSorted((a, b) => b.createdAt - a.createdAt)[0];
  if (
    latest &&
    (latest.status === 'possibly_stale' || (Array.isArray(latest.body.staleReasons) && latest.body.staleReasons.length))
  )
    gaps.push({ code: 'staleDocument', itemId: latest.id, title: latest.title });
  return {
    ready: gaps.length === 0,
    gaps,
    nextField: gaps.find((g) => g.field)?.field,
    requirementCount: requirements.length,
  };
}

export function validatePlanningBody(kind: StudioKind, body: StudioBody): void {
  const text = (key: string): void => {
    if (body[key] !== undefined && (typeof body[key] !== 'string' || (body[key] as string).length > 100_000))
      throw new Error('VALIDATION_FAILED');
  };
  if (kind === 'blueprint') {
    if (
      !object(body.fields) ||
      Object.entries(body.fields).some(
        ([key, value]) =>
          !BLUEPRINT_FIELDS.includes(key as BlueprintField) || typeof value !== 'string' || value.length > 100_000
      )
    )
      throw new Error('VALIDATION_FAILED');
  }
  if (kind === 'requirement') {
    ['content', 'normal', 'adverse'].forEach(text);
    if (
      typeof body.requirementId !== 'string' ||
      !/^FR-\d{3,}$/.test(body.requirementId) ||
      !['first', 'later'].includes(String(body.priority))
    )
      throw new Error('VALIDATION_FAILED');
  }
  if (kind === 'validation') {
    ['hypothesis', 'method', 'threshold', 'result', 'conclusion'].forEach(text);
    if (!['pending', 'continue', 'adjust', 'park', 'stop'].includes(String(body.outcome)))
      throw new Error('VALIDATION_FAILED');
    if (
      body.outcome !== 'pending' &&
      ['hypothesis', 'method', 'threshold', 'result', 'conclusion'].some((key) => !concreteText(body[key]))
    )
      throw new Error('VALIDATION_INCOMPLETE');
  }
}
