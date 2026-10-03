import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { StudioItem, StudioKind, StudioPack } from '../../../packages/desktop/src/common/types/studio';
import { StudioDocuments } from '../../../packages/desktop/src/process/services/studio/documents';
import { StudioStore } from '../../../packages/desktop/src/process/services/studio/store';

const root = resolve(process.cwd(), '..');
const harnesses: Harness[] = [];

type Harness = {
  dir: string;
  store: StudioStore;
  documents: StudioDocuments;
  projectId: string;
};

type ConfirmableKind = Extract<StudioKind, 'decision' | 'preference' | 'artifact'>;

function open(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'origin-integrity-'));
  const store = new StudioStore(join(dir, 'studio.db'));
  const documents = new StudioDocuments(root, dir, store);
  const projectId = store.createProject('完整性测试', '保留原件、历史与确认语义').id;
  const harness = { dir, store, documents, projectId };
  harnesses.push(harness);
  return harness;
}

function resign(pack: StudioPack): void {
  const { checksum: _checksum, ...payload } = pack;
  pack.checksum = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function bodyFor(kind: ConfirmableKind): Record<string, unknown> {
  if (kind === 'decision') {
    return { options: ['本地', '云端'], selected: '本地', reason: '保护隐私', basis: '当前约束' };
  }
  return { content: kind === 'preference' ? '偏好简洁表达' : '已确认的交付文档' };
}

function confirmable(store: StudioStore, projectId: string, kind: ConfirmableKind): StudioItem {
  const item = store.createItem(projectId, kind, kind, bodyFor(kind));
  return store.confirmItem(item.id, item.version);
}

async function tamperedMaterial(): Promise<{ harness: Harness; item: StudioItem }> {
  const harness = open();
  const item = harness.documents.upload(harness.projectId, 'evidence.txt', Buffer.from('original evidence'));
  await harness.documents.wait(item.id);
  writeFileSync(join(harness.dir, 'files', `${item.id}.txt`), 'tampered evidence');
  return { harness, item };
}

afterEach(async () => {
  const closing = harnesses.splice(0);
  await Promise.all(closing.map((harness) => harness.documents.close()));
  for (const harness of closing) {
    harness.store.close();
    rmSync(harness.dir, { recursive: true, force: true });
  }
});

describe('normal integrity', () => {
  it('preserves untampered original bytes through export and import', async () => {
    const { store, documents, projectId } = open();
    const original = Buffer.from('原点原件\n逐字保留');
    const material = documents.upload(projectId, 'source.txt', original);
    await documents.wait(material.id);

    const importedProject = documents.import(documents.export(projectId));
    const importedMaterial = store.items(importedProject.id, 'material')[0];

    expect(importedMaterial).toBeDefined();
    expect(documents.read(importedMaterial.id)).toEqual(original);
  });

  it('keeps validated history writable after export and import', () => {
    const { store, projectId } = open();
    const first = store.createItem(projectId, 'artifact', 'PRD', { content: '第一版' });
    const second = store.updateItem(first.id, first.version, { body: { content: '第二版' } });

    const importedProject = store.importProject(store.exportProject(projectId));
    const imported = store.items(importedProject.id, 'artifact')[0];
    const third = store.updateItem(imported.id, imported.version, { body: { content: '第三版' } });

    expect(third.version).toBe(second.version + 1);
    expect(store.versions(imported.id).map((entry) => entry.version)).toEqual([3, 2, 1]);
  });

  it('preserves prose that exactly equals another item old identifier', () => {
    const { store, projectId } = open();
    const referenced = store.createItem(projectId, 'material', '被引用资料', { content: '其他正文' });
    store.createItem(projectId, 'material', '原文资料', { content: referenced.id });

    const importedProject = store.importProject(store.exportProject(projectId));
    const imported = store.items(importedProject.id, 'material');
    const importedOriginal = imported.find((item) => item.title === '原文资料');
    const importedReferenced = imported.find((item) => item.title === '被引用资料');

    expect(importedOriginal?.body.content).toBe(referenced.id);
    expect(importedOriginal?.body.content).not.toBe(importedReferenced?.id);
  });

  it('preserves valid citation history and remaps only its references', () => {
    const { store, projectId } = open();
    const material = store.createItem(projectId, 'material', '访谈', { content: '第一句 / 第二句' });
    const citation = store.createItem(projectId, 'citation', '引用', { sourceId: material.id, quote: '第一句' });
    store.updateItem(citation.id, citation.version, { body: { sourceId: material.id, quote: '第二句' } });

    const importedProject = store.importProject(store.exportProject(projectId));
    const importedMaterial = store.items(importedProject.id, 'material')[0];
    const importedCitation = store.items(importedProject.id, 'citation')[0];
    const first = store.versions(importedCitation.id).find((entry) => entry.version === 1)?.snapshot;

    expect(importedCitation.body.quote).toBe('第二句');
    expect(first?.body.quote).toBe('第一句');
    expect([importedCitation.body.sourceId, first?.body.sourceId]).toEqual([importedMaterial.id, importedMaterial.id]);
  });

  it('rejects stale edits without changing valid imported history', () => {
    const { store, projectId } = open();
    const item = store.createItem(projectId, 'artifact', 'PRD', { content: '第一版' });
    const latest = store.updateItem(item.id, item.version, { body: { content: '第二版' } });
    const importedProject = store.importProject(store.exportProject(projectId));
    const imported = store.items(importedProject.id, 'artifact')[0];

    expect(() => store.updateItem(imported.id, latest.version - 1, { body: { content: '过期覆盖' } })).toThrow(
      'VERSION_CONFLICT'
    );
    expect(store.versions(imported.id).map((entry) => entry.version)).toEqual([2, 1]);
  });
});

describe('adversarial integrity', () => {
  it.each(['read', 'parse', 'export'] as const)('rejects a tampered original before %s', async (operation) => {
    const { harness, item } = await tamperedMaterial();

    const action =
      operation === 'read'
        ? () => harness.documents.read(item.id)
        : operation === 'parse'
          ? () => harness.documents.parse(item.id)
          : () => harness.documents.export(harness.projectId);

    expect(action).toThrow('INTEGRITY_FAILED');
  });

  it.each(['fileHash', 'fileSize'] as const)(
    'rejects attachment %s metadata that disagrees with its bytes',
    async (field) => {
      const { store, documents, projectId } = open();
      const material = documents.upload(projectId, 'source.txt', Buffer.from('trusted bytes'));
      await documents.wait(material.id);
      const projectsBefore = store.projects().length;
      const pack = documents.export(projectId);
      const exported = pack.items.find((item) => item.id === material.id);
      if (!exported) throw new Error('TEST_SETUP_FAILED');

      exported.body[field] = field === 'fileHash' ? '0'.repeat(64) : Number(exported.body.fileSize) + 1;
      resign(pack);

      expect(() => documents.import(pack)).toThrow('INTEGRITY_FAILED');
      expect(store.projects()).toHaveLength(projectsBefore);
    }
  );

  it('rejects imported history newer than the current item', () => {
    const { store, projectId } = open();
    const item = store.createItem(projectId, 'artifact', 'PRD', { content: '当前版本' });
    const pack = store.exportProject(projectId);
    pack.versions.push({
      itemId: item.id,
      version: item.version + 1,
      snapshot: { ...item, version: item.version + 1, body: { content: '未来版本' } },
      createdAt: Date.now(),
    });
    resign(pack);

    expect(() => store.importProject(pack)).toThrow('INVALID_PACKAGE');
  });

  it('rejects history whose snapshot version disagrees with its index', () => {
    const { store, projectId } = open();
    const first = store.createItem(projectId, 'artifact', 'PRD', { content: '第一版' });
    store.updateItem(first.id, first.version, { body: { content: '第二版' } });
    const pack = store.exportProject(projectId);
    const oldest = pack.versions.find((entry) => entry.itemId === first.id && entry.version === 1);
    if (!oldest) throw new Error('TEST_SETUP_FAILED');
    oldest.snapshot.version = 99;
    resign(pack);

    expect(() => store.importProject(pack)).toThrow('INVALID_PACKAGE');
  });

  it('rejects a forged quotation in an otherwise valid historical snapshot', () => {
    const { store, projectId } = open();
    const material = store.createItem(projectId, 'material', '访谈', { content: '第一句 / 第二句' });
    const citation = store.createItem(projectId, 'citation', '引用', { sourceId: material.id, quote: '第一句' });
    store.updateItem(citation.id, citation.version, { body: { sourceId: material.id, quote: '第二句' } });
    const projectsBefore = store.projects().length;
    const pack = store.exportProject(projectId);
    const historical = pack.versions.find((entry) => entry.itemId === citation.id && entry.version === 1);
    if (!historical) throw new Error('TEST_SETUP_FAILED');
    historical.snapshot.body.quote = '从未出现的伪造引文';
    resign(pack);

    expect(() => store.importProject(pack)).toThrow('INVALID_PACKAGE');
    expect(store.projects()).toHaveLength(projectsBefore);
  });

  it.each([
    ['decision', 'decided', 'draft'],
    ['preference', 'confirmed', 'suggested'],
    ['artifact', 'current', 'draft'],
  ] as const)('requires user reconfirmation for an imported %s in %s state', (kind, sourceStatus, importedStatus) => {
    const { store, projectId } = open();
    confirmable(store, projectId, kind);

    const importedProject = store.importProject(store.exportProject(projectId));
    const imported = store.items(importedProject.id, kind)[0];

    expect(imported.status).toBe(importedStatus);
    expect(imported.body.confirmedAt).toBeUndefined();
    expect(imported.body.confirmedBy).toBeUndefined();
    expect(imported.body.importedProvenance).toMatchObject({ sourceStatus });
  });

  it('records imported provenance as a new version while retaining validated history', () => {
    const { store, projectId } = open();
    const confirmed = confirmable(store, projectId, 'decision');

    const importedProject = store.importProject(store.exportProject(projectId));
    const imported = store.items(importedProject.id, 'decision')[0];
    const prior = store.versions(imported.id).find((entry) => entry.version === confirmed.version);

    expect(imported.version).toBe(confirmed.version + 1);
    expect(imported.body.importedProvenance).toEqual({
      sourceItemId: confirmed.id,
      sourceVersion: confirmed.version,
      sourceStatus: confirmed.status,
    });
    expect(prior?.snapshot.status).toBe('decided');
  });

  it('does not leave a material record when the original cannot be written', () => {
    const { dir, store, documents, projectId } = open();
    const filesPath = join(dir, 'files');
    rmSync(filesPath, { recursive: true, force: true });
    writeFileSync(filesPath, 'blocks child paths');

    expect(() => documents.upload(projectId, 'source.txt', Buffer.from('original'))).toThrow();
    expect(store.items(projectId, 'material')).toHaveLength(0);

    rmSync(filesPath, { force: true });
    mkdirSync(filesPath, { recursive: true, mode: 0o700 });
  });

  it('invalidates linked artifacts and canvases after a trusted material update', () => {
    const { store, projectId } = open();
    const material = store.createItem(projectId, 'material', '访谈', { content: '旧证据' });
    const artifact = store.createItem(projectId, 'artifact', 'PRD', {
      content: '基于旧证据',
      sourceIds: [material.id],
    });
    const currentArtifact = store.confirmItem(artifact.id, artifact.version);
    const canvas = store.createItem(projectId, 'canvas', '方案图', { elements: [], sourceIds: [material.id] });

    store.systemUpdate(material.id, material.version, { body: { ...material.body, content: '新证据' } });

    expect(currentArtifact.status).toBe('current');
    expect(store.getItem(artifact.id).status).toBe('possibly_stale');
    expect(store.getItem(canvas.id).status).toBe('possibly_stale');
  });

  it('returns an edited confirmed preference to suggested without stale confirmation metadata', () => {
    const { store, projectId } = open();
    const preference = store.createItem(projectId, 'preference', '表达偏好', { content: '简洁' });
    const confirmed = store.confirmItem(preference.id, preference.version);

    const edited = store.updateItem(confirmed.id, confirmed.version, { body: { ...confirmed.body, content: '详细' } });

    expect(edited.status).toBe('suggested');
    expect(edited.body.confirmedAt).toBeUndefined();
    expect(edited.body.confirmedBy).toBeUndefined();
  });
});
