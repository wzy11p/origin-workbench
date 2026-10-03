import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { importedCurrent, STATUSES, validateArchive } from './archive';
import { validatePlanningBody } from '../../../common/studio/blueprint';
import type {
  StudioBody,
  StudioItem,
  StudioKind,
  StudioPack,
  StudioPatch,
  StudioProject,
  StudioVersion,
} from '../../../common/types/studio';

const KINDS = new Set<StudioKind>([
  'capture',
  'material',
  'citation',
  'insight',
  'assumption',
  'decision',
  'preference',
  'canvas',
  'artifact',
  'workflow',
  'review',
  'blueprint',
  'requirement',
  'validation',
]);
const STAGES = new Set(['灵感', '发现', '定义', '设计', '验证', '交付', '暂停']);
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const titleOf = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 160) throw new Error('VALIDATION_FAILED');
  return value.trim();
};
const bodyOf = (value: unknown): StudioBody => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED');
  const text = JSON.stringify(value);
  if (text.length > 5_000_000 || /"(?:__proto__|constructor|prototype)"\s*:/.test(text))
    throw new Error('VALIDATION_FAILED');
  return JSON.parse(text) as StudioBody;
};
const asItem = (row: Record<string, unknown>): StudioItem => ({
  id: String(row.id),
  projectId: row.project_id === null ? null : String(row.project_id),
  kind: row.kind as StudioKind,
  title: String(row.title),
  body: JSON.parse(String(row.body)) as StudioBody,
  status: String(row.status),
  version: Number(row.version),
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
});
const asProject = (row: Record<string, unknown>): StudioProject => ({
  id: String(row.id),
  title: String(row.title),
  intent: String(row.intent),
  stage: String(row.stage),
  archived: Boolean(row.archived),
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
});

/** Local, transactionally versioned product assets. The host supplies authentication. */
export class StudioStore {
  private db: DatabaseSync;
  private closed = false;
  private transactionDepth = 0;
  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS studio_projects(id TEXT PRIMARY KEY, title TEXT NOT NULL, intent TEXT NOT NULL, stage TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS studio_items(id TEXT PRIMARY KEY, project_id TEXT REFERENCES studio_projects(id) ON DELETE CASCADE, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS studio_items_project ON studio_items(project_id,kind,updated_at);
      CREATE TABLE IF NOT EXISTS studio_versions(item_id TEXT NOT NULL REFERENCES studio_items(id) ON DELETE CASCADE, version INTEGER NOT NULL, snapshot TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(item_id,version));
      CREATE TABLE IF NOT EXISTS studio_idempotency(key TEXT PRIMARY KEY, request_hash TEXT NOT NULL, response TEXT NOT NULL, created_at INTEGER NOT NULL);`);
    for (const row of this.db
      .prepare("SELECT * FROM studio_items WHERE status IN ('queued','parsing','running')")
      .all()) {
      const item = asItem(row);
      this.writeVersion({ ...item, status: 'interrupted', version: item.version + 1, updatedAt: Date.now() });
    }
  }
  close(): void {
    if (!this.closed) {
      this.db.close();
      this.closed = true;
    }
  }
  private transaction<T>(fn: () => T): T {
    if (this.transactionDepth) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.transactionDepth++;
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }
  projects(): StudioProject[] {
    return this.db.prepare('SELECT * FROM studio_projects ORDER BY archived, updated_at DESC').all().map(asProject);
  }
  project(id: string): StudioProject {
    const row = this.db.prepare('SELECT * FROM studio_projects WHERE id=?').get(id);
    if (!row) throw new Error('NOT_FOUND');
    return asProject(row);
  }
  createProject(title: string, intent: string): StudioProject {
    const name = titleOf(title);
    if (typeof intent !== 'string' || intent.length > 20_000) throw new Error('VALIDATION_FAILED');
    const p: StudioProject = {
      id: randomUUID(),
      title: name,
      intent,
      stage: '灵感',
      archived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.db
      .prepare('INSERT INTO studio_projects VALUES (?,?,?,?,?,?,?)')
      .run(p.id, p.title, p.intent, p.stage, 0, p.createdAt, p.updatedAt);
    return p;
  }
  updateProject(
    id: string,
    patch: Partial<Pick<StudioProject, 'title' | 'intent' | 'stage' | 'archived'>>
  ): StudioProject {
    const old = this.project(id);
    const p = { ...old, ...patch };
    titleOf(p.title);
    if (
      typeof p.intent !== 'string' ||
      p.intent.length > 20_000 ||
      !STAGES.has(p.stage) ||
      typeof p.archived !== 'boolean'
    )
      throw new Error('VALIDATION_FAILED');
    this.transaction(() => {
      this.db
        .prepare('UPDATE studio_projects SET title=?,intent=?,stage=?,archived=?,updated_at=? WHERE id=?')
        .run(p.title.trim(), p.intent, p.stage, Number(p.archived), Date.now(), id);
      if (p.title !== old.title || p.intent !== old.intent)
        for (const item of this.items(id))
          if (item.kind === 'artifact' && item.body.compiler)
            this.markStale(item, { sourceId: id, title: p.title, reason: 'project_changed' });
    });
    return this.project(id);
  }
  deleteProject(id: string, confirmation: string): void {
    if (confirmation !== this.project(id).title) throw new Error('CONFIRMATION_REQUIRED');
    this.transaction(() => {
      this.db.prepare('DELETE FROM studio_projects WHERE id=?').run(id);
      this.db.prepare('DELETE FROM studio_idempotency').run();
    });
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');
  }
  items(projectId: string | null, kind?: StudioKind): StudioItem[] {
    if (projectId) this.project(projectId);
    const rows = kind
      ? this.db
          .prepare('SELECT * FROM studio_items WHERE project_id IS ? AND kind=? ORDER BY updated_at DESC')
          .all(projectId, kind)
      : this.db.prepare('SELECT * FROM studio_items WHERE project_id IS ? ORDER BY updated_at DESC').all(projectId);
    return rows.map(asItem);
  }
  getItem(id: string): StudioItem {
    const row = this.db.prepare('SELECT * FROM studio_items WHERE id=?').get(id);
    if (!row) throw new Error('NOT_FOUND');
    return asItem(row);
  }
  private validateReferences(projectId: string | null, kind: StudioKind, body: StudioBody): StudioBody {
    const result = bodyOf(body);
    validatePlanningBody(kind, result);
    const ids: string[] = [];
    if (typeof result.sourceId === 'string') ids.push(result.sourceId);
    if (Array.isArray(result.sourceIds)) {
      if (result.sourceIds.some((id) => typeof id !== 'string')) throw new Error('INVALID_REFERENCE');
      ids.push(...(result.sourceIds as string[]));
    }
    for (const id of ids) {
      let target: StudioItem;
      try {
        target = this.getItem(id);
      } catch {
        throw new Error('INVALID_REFERENCE');
      }
      if (target.projectId !== projectId && !(target.kind === 'preference' && target.projectId === null))
        throw new Error('INVALID_REFERENCE');
    }
    if (kind === 'citation') {
      if (typeof result.sourceId !== 'string' || typeof result.quote !== 'string' || !result.quote.trim())
        throw new Error('INVALID_QUOTE');
      const source = this.getItem(result.sourceId);
      const version = typeof result.sourceVersion === 'number' ? result.sourceVersion : source.version;
      const snapshot = this.versions(source.id).find((v) => v.version === version)?.snapshot;
      if (
        source.kind !== 'material' ||
        !snapshot ||
        typeof snapshot.body.content !== 'string' ||
        !snapshot.body.content.includes(result.quote)
      )
        throw new Error('INVALID_QUOTE');
      result.sourceVersion = version;
      result.quoteHash = hash(result.quote);
    }
    return result;
  }
  createItem(
    projectId: string | null,
    kind: StudioKind,
    title: string,
    body: StudioBody,
    persistOriginal?: (item: StudioItem) => void
  ): StudioItem {
    if (!KINDS.has(kind)) throw new Error('VALIDATION_FAILED');
    if (projectId) this.project(projectId);
    else if (!['capture', 'preference'].includes(kind)) throw new Error('INVALID_REFERENCE');
    if (kind === 'requirement') {
      const numbers = this.items(projectId, 'requirement').map(
        (i) => Number(String(i.body.requirementId).slice(3)) || 0
      );
      body = { ...body, requirementId: `FR-${String(Math.max(0, ...numbers) + 1).padStart(3, '0')}` };
    }
    const item: StudioItem = {
      id: randomUUID(),
      projectId,
      kind,
      title: titleOf(title),
      body: this.validateReferences(projectId, kind, body),
      status: kind === 'preference' ? 'suggested' : kind === 'capture' ? 'unprocessed' : 'draft',
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.transaction(() => {
      this.writeVersion(item);
      persistOriginal?.(item);
    });
    return item;
  }
  private markStale(item: StudioItem, reason: StudioBody): void {
    if (['archived', 'deprecated'].includes(item.status)) return;
    const previous = Array.isArray(item.body.staleReasons) ? (item.body.staleReasons as StudioBody[]) : [];
    const reasons = [...previous.filter((r) => r.sourceId !== reason.sourceId), reason].slice(-100);
    this.writeVersion(
      {
        ...item,
        status: 'possibly_stale',
        body: { ...item.body, staleReasons: reasons },
        version: item.version + 1,
        updatedAt: Date.now(),
      },
      false
    );
  }
  private invalidateDependents(source: StudioItem): void {
    const candidates = source.projectId
      ? this.items(source.projectId)
      : this.projects().flatMap((p) => this.items(p.id));
    const affected = new Set([source.id]);
    // Traverse evidence links without changing quoted snapshots or recursively writing a cycle.
    let advanced = true;
    while (advanced) {
      advanced = false;
      for (const item of candidates) {
        const refs = [...(Array.isArray(item.body.sourceIds) ? item.body.sourceIds : []), item.body.sourceId];
        const recipeChange =
          [
            'preference',
            'blueprint',
            'requirement',
            'workflow',
            'decision',
            'validation',
            'citation',
            'capture',
            'insight',
            'assumption',
            'canvas',
          ].includes(source.kind) &&
          item.kind === 'artifact' &&
          Boolean(item.body.compiler);
        if (!affected.has(item.id) && (recipeChange || refs.some((id) => typeof id === 'string' && affected.has(id)))) {
          affected.add(item.id);
          advanced = true;
        }
      }
    }
    for (const item of candidates)
      if (item.id !== source.id && affected.has(item.id) && ['artifact', 'canvas'].includes(item.kind))
        this.markStale(item, {
          sourceId: source.id,
          title: source.title,
          version: source.version,
          reason: 'source_changed',
        });
  }
  private writeVersion(item: StudioItem, invalidate = true): void {
    const previous = this.db.prepare('SELECT * FROM studio_items WHERE id=?').get(item.id);
    this.db
      .prepare(
        'INSERT INTO studio_items VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,status=excluded.status,version=excluded.version,updated_at=excluded.updated_at'
      )
      .run(
        item.id,
        item.projectId,
        item.kind,
        item.title,
        JSON.stringify(item.body),
        item.status,
        item.version,
        item.createdAt,
        item.updatedAt
      );
    this.db
      .prepare('INSERT INTO studio_versions VALUES (?,?,?,?)')
      .run(item.id, item.version, JSON.stringify(item), item.updatedAt);
    if (item.projectId)
      this.db.prepare('UPDATE studio_projects SET updated_at=? WHERE id=?').run(item.updatedAt, item.projectId);
    if (previous && invalidate) {
      const old = asItem(previous);
      const changed =
        item.kind === 'material'
          ? old.body.content !== item.body.content || old.title !== item.title || item.status === 'archived'
          : hash(old.body) !== hash(item.body) || old.status !== item.status || old.title !== item.title;
      if (changed) this.invalidateDependents(item);
    }
    if (
      !previous &&
      invalidate &&
      item.projectId &&
      [
        'blueprint',
        'requirement',
        'workflow',
        'decision',
        'validation',
        'citation',
        'capture',
        'insight',
        'assumption',
        'canvas',
      ].includes(item.kind)
    )
      this.invalidateDependents(item);
  }
  updateItem(id: string, expected: number, patch: StudioPatch): StudioItem {
    const old = this.getItem(id);
    if (old.version !== expected) throw new Error('VERSION_CONFLICT');
    if (patch.status && ['decided', 'confirmed', 'current'].includes(patch.status))
      throw new Error('CONFIRMATION_REQUIRED');
    if (
      patch.status &&
      (!['draft', 'in_review', 'archived', 'deprecated', 'rejected', 'ignored', 'unprocessed'].includes(patch.status) ||
        !STATUSES[old.kind].includes(patch.status))
    )
      throw new Error('INVALID_STATE');
    if (old.kind === 'capture' && patch.body && patch.body.content !== old.body.content)
      throw new Error('ORIGINAL_IMMUTABLE');
    if (old.kind === 'requirement' && patch.body && patch.body.requirementId !== old.body.requirementId)
      throw new Error('ORIGINAL_IMMUTABLE');
    const changed =
      (patch.title !== undefined && patch.title !== old.title) ||
      (patch.body !== undefined && hash(patch.body) !== hash(old.body));
    const losesConfirmation = changed && ['decided', 'confirmed', 'current'].includes(old.status);
    const nextBody =
      patch.body === undefined ? { ...old.body } : this.validateReferences(old.projectId, old.kind, patch.body);
    if (losesConfirmation) {
      delete nextBody.confirmedAt;
      delete nextBody.confirmedBy;
    }
    const next: StudioItem = {
      ...old,
      title: patch.title === undefined ? old.title : titleOf(patch.title),
      body: nextBody,
      status: patch.status ?? (losesConfirmation ? (old.kind === 'preference' ? 'suggested' : 'draft') : old.status),
      version: old.version + 1,
      updatedAt: Date.now(),
    };
    this.transaction(() => this.writeVersion(next));
    return next;
  }
  confirmDecision(id: string, expected: number): StudioItem {
    const d = this.getItem(id);
    if (d.version !== expected) throw new Error('VERSION_CONFLICT');
    if (d.kind !== 'decision' || !['draft', 'needs_evidence'].includes(d.status)) throw new Error('INVALID_STATE');
    const options = d.body.options;
    if (
      !Array.isArray(options) ||
      new Set(options).size < 2 ||
      options.some((o) => typeof o !== 'string' || !o.trim()) ||
      !options.includes(d.body.selected) ||
      typeof d.body.reason !== 'string' ||
      !d.body.reason.trim() ||
      typeof d.body.basis !== 'string' ||
      !d.body.basis.trim()
    )
      throw new Error('DECISION_INCOMPLETE');
    return this.systemUpdate(id, expected, {
      status: 'decided',
      body: { ...d.body, confirmedAt: Date.now(), confirmedBy: 'user' },
    });
  }
  confirmItem(id: string, expected: number): StudioItem {
    const i = this.getItem(id);
    if (i.kind === 'decision') return this.confirmDecision(id, expected);
    if (
      !['preference', 'artifact', 'insight', 'assumption'].includes(i.kind) ||
      ['archived', 'deprecated'].includes(i.status)
    )
      throw new Error('INVALID_STATE');
    if (typeof i.body.content !== 'string' || !i.body.content.trim()) throw new Error('VALIDATION_FAILED');
    return this.systemUpdate(id, expected, {
      status: i.kind === 'artifact' ? 'current' : 'confirmed',
      body: { ...i.body, confirmedAt: Date.now(), confirmedBy: 'user' },
    });
  }
  systemUpdate(id: string, expected: number, patch: StudioPatch): StudioItem {
    const old = this.getItem(id);
    if (old.version !== expected) throw new Error('VERSION_CONFLICT');
    const next = {
      ...old,
      ...patch,
      body: patch.body ? bodyOf(patch.body) : old.body,
      version: old.version + 1,
      updatedAt: Date.now(),
    };
    this.transaction(() => this.writeVersion(next));
    return next;
  }
  versions(id: string): StudioVersion[] {
    this.getItem(id);
    return this.db
      .prepare('SELECT * FROM studio_versions WHERE item_id=? ORDER BY version DESC')
      .all(id)
      .map((row) => ({
        itemId: String(row.item_id),
        version: Number(row.version),
        snapshot: JSON.parse(String(row.snapshot)) as StudioItem,
        createdAt: Number(row.created_at),
      }));
  }
  exportProject(id: string): StudioPack {
    const collected = new Map(this.items(id).map((item) => [item.id, item]));
    const pending = [...collected.values()];
    while (pending.length) {
      const item = pending.pop()!;
      for (const v of this.versions(item.id)) {
        const refs = [
          ...(Array.isArray(v.snapshot.body.sourceIds) ? v.snapshot.body.sourceIds : []),
          ...(typeof v.snapshot.body.sourceId === 'string' ? [v.snapshot.body.sourceId] : []),
        ];
        for (const ref of refs)
          if (typeof ref === 'string' && !collected.has(ref)) {
            const source = this.getItem(ref);
            if (source.projectId === null && source.kind === 'preference') {
              collected.set(ref, source);
              pending.push(source);
            }
          }
      }
    }
    const snapshot = (item: StudioItem): StudioItem =>
      item.projectId === null ? { ...item, projectId: id, body: { ...item.body, originalScope: 'global' } } : item;
    const items = [...collected.values()].map(snapshot);
    const payload = {
      format: 'yuandian-project' as const,
      schema: 1 as const,
      project: this.project(id),
      items,
      versions: items.flatMap((i) => this.versions(i.id).map((v) => ({ ...v, snapshot: snapshot(v.snapshot) }))),
    };
    if (payload.items.length > 10_000 || payload.versions.length > 100_000) throw new Error('EXPORT_TOO_LARGE');
    return validateArchive({ ...payload, checksum: hash(payload) });
  }
  importProject(input: unknown, restoreFiles?: (ids: Map<string, string>) => void): StudioProject {
    const pack = validateArchive(input);
    titleOf(pack.project.title);
    const ids = new Map(pack.items.map((i) => [i.id, randomUUID()]));
    if (ids.size !== pack.items.length) throw new Error('INVALID_PACKAGE');
    const remap = (body: StudioBody, kind: StudioKind): StudioBody => {
      const result = structuredClone(body);
      for (const key of ['sourceId', 'targetId', 'supersedesId', 'originalCaptureId'])
        if (typeof result[key] === 'string') result[key] = ids.get(result[key] as string) ?? result[key];
      if (Array.isArray(result.sourceIds))
        result.sourceIds = result.sourceIds.map((id) => (typeof id === 'string' ? (ids.get(id) ?? id) : id));
      if (result.sourceVersions && typeof result.sourceVersions === 'object' && !Array.isArray(result.sourceVersions))
        result.sourceVersions = Object.fromEntries(
          Object.entries(result.sourceVersions).map(([key, value]) => [ids.get(key) ?? key, value])
        );
      if (Array.isArray(result.preferenceSnapshot))
        result.preferenceSnapshot = result.preferenceSnapshot.map((value) => {
          if (!value || typeof value !== 'object') return value;
          const pref = value as StudioBody;
          return { ...pref, id: typeof pref.id === 'string' ? (ids.get(pref.id) ?? pref.id) : pref.id };
        });
      if (result.previousArtifact && typeof result.previousArtifact === 'object') {
        const previous = result.previousArtifact as StudioBody;
        result.previousArtifact = {
          ...previous,
          id: typeof previous.id === 'string' ? (ids.get(previous.id) ?? previous.id) : previous.id,
        };
      }
      if (result.projectSnapshot && typeof result.projectSnapshot === 'object')
        result.projectSnapshot = { ...(result.projectSnapshot as StudioBody), id: undefined };
      if (kind === 'artifact' && typeof result.content === 'string')
        result.content = result.content.replace(/origin:\/\/item\/([a-f0-9-]{36})/g, (link, id: string) =>
          ids.has(id) ? `origin://item/${ids.get(id)}` : link
        );
      return result;
    };
    return this.transaction(() => {
      const p = this.createProject(pack.project.title, pack.project.intent);
      this.updateProject(p.id, { stage: pack.project.stage, archived: pack.project.archived });
      for (const item of pack.items) {
        if (
          !KINDS.has(item.kind) ||
          item.projectId !== pack.project.id ||
          !Number.isInteger(item.version) ||
          item.version < 1
        )
          throw new Error('INVALID_PACKAGE');
        const next = {
          ...item,
          id: ids.get(item.id) as string,
          projectId: p.id,
          title: titleOf(item.title),
          body: bodyOf(remap(item.body, item.kind)),
          updatedAt: item.updatedAt,
        };
        this.writeVersion(next, false);
      }
      for (const v of pack.versions) {
        const id = ids.get(v.itemId);
        if (!id || !Number.isInteger(v.version) || v.version < 1) throw new Error('INVALID_PACKAGE');
        const snapshot = { ...v.snapshot, id, projectId: p.id, body: bodyOf(remap(v.snapshot.body, v.snapshot.kind)) };
        this.db
          .prepare('INSERT OR IGNORE INTO studio_versions VALUES (?,?,?,?)')
          .run(id, v.version, JSON.stringify(snapshot), v.createdAt);
      }
      for (const item of this.items(p.id)) this.validateReferences(p.id, item.kind, item.body);
      for (const source of pack.items) {
        const item = this.getItem(ids.get(source.id) as string);
        const pending = importedCurrent(item, source);
        if (pending) this.writeVersion(pending, false);
      }
      restoreFiles?.(ids);
      return this.project(p.id);
    });
  }
  idempotent<T>(key: string, input: unknown, fn: () => T): T {
    if (!key || key.length > 180) throw new Error('INVALID_IDEMPOTENCY_KEY');
    const fingerprint = hash(input);
    const old = this.db.prepare('SELECT * FROM studio_idempotency WHERE key=?').get(key);
    if (old) {
      if (old.request_hash !== fingerprint) throw new Error('IDEMPOTENCY_CONFLICT');
      return JSON.parse(String(old.response)) as T;
    }
    return this.transaction(() => {
      const result = fn();
      this.db
        .prepare('INSERT INTO studio_idempotency VALUES (?,?,?,?)')
        .run(key, fingerprint, JSON.stringify(result), Date.now());
      return result;
    });
  }
}
