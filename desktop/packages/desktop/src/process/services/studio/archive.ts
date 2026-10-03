import { createHash } from 'node:crypto';
import { validateCanvas } from '../../../common/studio/canvas';
import { validatePlanningBody } from '../../../common/studio/blueprint';
import type { StudioBody, StudioItem, StudioKind, StudioPack } from '../../../common/types/studio';

export const STATUSES: Record<StudioKind, readonly string[]> = {
  capture: ['unprocessed', 'processed', 'ignored', 'archived', 'draft'],
  material: ['draft', 'queued', 'parsing', 'ready', 'partial', 'failed', 'interrupted', 'cancelled', 'archived'],
  citation: ['draft', 'archived'],
  insight: ['draft', 'confirmed', 'in_review', 'archived', 'rejected'],
  assumption: ['draft', 'confirmed', 'in_review', 'archived', 'rejected'],
  decision: ['draft', 'needs_evidence', 'decided', 'in_review', 'archived', 'rejected'],
  preference: ['suggested', 'draft', 'confirmed', 'deprecated', 'archived', 'rejected'],
  canvas: ['draft', 'possibly_stale', 'archived'],
  artifact: ['draft', 'current', 'possibly_stale', 'in_review', 'archived'],
  workflow: ['draft', 'completed', 'in_review', 'archived'],
  review: ['draft', 'running', 'completed', 'partial', 'failed', 'cancelled', 'interrupted', 'archived'],
  blueprint: ['draft', 'archived'],
  requirement: ['draft', 'archived'],
  validation: ['draft', 'archived'],
};
const object = (value: unknown): value is StudioBody =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const validTime = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value))
    return `{${Object.keys(value)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
};
function validateItem(item: StudioItem, projectId: string): void {
  if (
    !object(item) ||
    typeof item.id !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(item.id) ||
    item.projectId !== projectId ||
    !STATUSES[item.kind]?.includes(item.status) ||
    !Number.isSafeInteger(item.version) ||
    item.version < 1 ||
    !validTime(item.createdAt) ||
    !validTime(item.updatedAt) ||
    typeof item.title !== 'string' ||
    !item.title.trim() ||
    item.title.length > 160 ||
    !object(item.body)
  )
    throw new Error('INVALID_PACKAGE');
  if (
    ['decided', 'confirmed', 'current'].includes(item.status) &&
    (!validTime(item.body.confirmedAt) || item.body.confirmedBy !== 'user')
  )
    throw new Error('INVALID_PACKAGE');
  if (item.kind === 'decision' && item.status === 'decided') {
    const options = item.body.options;
    if (
      !Array.isArray(options) ||
      options.some((o) => typeof o !== 'string' || !o.trim()) ||
      new Set(options).size < 2 ||
      !options.includes(item.body.selected) ||
      typeof item.body.reason !== 'string' ||
      !item.body.reason.trim() ||
      typeof item.body.basis !== 'string' ||
      !item.body.basis.trim()
    )
      throw new Error('INVALID_PACKAGE');
  }
  if (
    ['confirmed', 'current'].includes(item.status) &&
    (typeof item.body.content !== 'string' || !item.body.content.trim())
  )
    throw new Error('INVALID_PACKAGE');
}

/** A checksum detects damage, not trust. Validate the full version graph before a transaction. */
export function validateArchive(input: unknown): StudioPack {
  if (!object(input)) throw new Error('INVALID_PACKAGE');
  const pack = input as unknown as StudioPack;
  const { checksum, ...payload } = pack;
  if (typeof checksum !== 'string' || createHash('sha256').update(JSON.stringify(payload)).digest('hex') !== checksum)
    throw new Error('INTEGRITY_FAILED');
  if (
    pack.format !== 'yuandian-project' ||
    pack.schema !== 1 ||
    !object(pack.project) ||
    typeof pack.project.id !== 'string' ||
    !Array.isArray(pack.items) ||
    pack.items.length > 10_000 ||
    !Array.isArray(pack.versions) ||
    pack.versions.length > 100_000
  )
    throw new Error('INVALID_PACKAGE');
  const items = new Map<string, StudioItem>();
  const requirementIds = new Set<string>();
  for (const item of pack.items) {
    validateItem(item, pack.project.id);
    if (items.has(item.id)) throw new Error('INVALID_PACKAGE');
    if (item.kind === 'requirement') {
      const number = String(item.body.requirementId);
      if (requirementIds.has(number)) throw new Error('INVALID_PACKAGE');
      requirementIds.add(number);
    }
    items.set(item.id, item);
  }
  const seen = new Map<string, Set<number>>();
  const latest = new Map<string, StudioItem>();
  for (const entry of pack.versions) {
    const current = items.get(entry.itemId);
    if (
      !current ||
      !Number.isSafeInteger(entry.version) ||
      entry.version < 1 ||
      entry.version > current.version ||
      !validTime(entry.createdAt)
    )
      throw new Error('INVALID_PACKAGE');
    validateItem(entry.snapshot, pack.project.id);
    if (
      entry.snapshot.id !== current.id ||
      entry.snapshot.kind !== current.kind ||
      entry.snapshot.version !== entry.version ||
      entry.snapshot.updatedAt !== entry.createdAt ||
      entry.snapshot.createdAt !== current.createdAt
    )
      throw new Error('INVALID_PACKAGE');
    const versions = seen.get(entry.itemId) ?? new Set<number>();
    if (versions.has(entry.version)) throw new Error('INVALID_PACKAGE');
    versions.add(entry.version);
    seen.set(entry.itemId, versions);
    if (entry.version === current.version) latest.set(entry.itemId, entry.snapshot);
  }
  for (const item of items.values())
    if (seen.get(item.id)?.size !== item.version || canonical(latest.get(item.id)) !== canonical(item))
      throw new Error('INVALID_PACKAGE');
  const snapshots = new Map(pack.versions.map((v) => [`${v.itemId}:${v.version}`, v.snapshot]));
  for (const entry of pack.versions) {
    const item = entry.snapshot;
    validatePlanningBody(item.kind, item.body);
    if (item.kind === 'canvas') validateCanvas(item.body);
    if (item.kind === 'citation') {
      const source = snapshots.get(`${String(item.body.sourceId)}:${String(item.body.sourceVersion)}`);
      const quote = item.body.quote;
      if (
        !source ||
        source.kind !== 'material' ||
        typeof quote !== 'string' ||
        !quote.trim() ||
        typeof source.body.content !== 'string' ||
        !source.body.content.includes(quote) ||
        item.body.quoteHash !== createHash('sha256').update(JSON.stringify(quote)).digest('hex')
      )
        throw new Error('INVALID_PACKAGE');
    }
    const refs = [
      ...(Array.isArray(item.body.sourceIds) ? item.body.sourceIds : []),
      ...(typeof item.body.sourceId === 'string' ? [item.body.sourceId] : []),
    ];
    if (refs.some((id) => typeof id !== 'string' || !items.has(id))) throw new Error('INVALID_REFERENCE');
    const current = items.get(item.id)!;
    if (item.kind === 'requirement' && item.body.requirementId !== current.body.requirementId)
      throw new Error('ORIGINAL_IMMUTABLE');
    if (item.kind === 'capture' && current.body.content !== item.body.content) throw new Error('ORIGINAL_IMMUTABLE');
    if (
      item.kind === 'material' &&
      ['fileExtension', 'fileHash', 'fileSize', 'filename'].some((key) => item.body[key] !== current.body[key])
    )
      throw new Error('ORIGINAL_IMMUTABLE');
  }
  return pack;
}

/** Imported assertions remain history until the current user confirms them again. */
export function importedCurrent(item: StudioItem, source: StudioItem): StudioItem | null {
  const confirmed = ['decided', 'confirmed', 'current'].includes(source.status);
  const interrupted = ['running', 'parsing', 'queued'].includes(item.status);
  if (!confirmed && !interrupted) return null;
  const body: StudioBody = {
    ...item.body,
    importedProvenance: { sourceItemId: source.id, sourceVersion: source.version, sourceStatus: source.status },
  };
  delete body.confirmedAt;
  delete body.confirmedBy;
  return {
    ...item,
    body,
    status: interrupted ? 'interrupted' : item.kind === 'preference' ? 'suggested' : 'draft',
    version: item.version + 1,
    updatedAt: Date.now(),
  };
}
