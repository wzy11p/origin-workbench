import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { StudioStore } from '../../../packages/desktop/src/process/services/studio/store';
import { StudioDocuments } from '../../../packages/desktop/src/process/services/studio/documents';
import { StudioBackups } from '../../../packages/desktop/src/process/services/studio/backups';
const harnesses: { dir: string; store: StudioStore; documents: StudioDocuments; backups: StudioBackups }[] = [];
const open = () => {
  const dir = mkdtempSync(join(tmpdir(), 'origin-backup-'));
  const store = new StudioStore(join(dir, 'db'));
  const documents = new StudioDocuments(resolve(process.cwd(), '..'), dir, store);
  const backups = new StudioBackups(dir, store, documents);
  const h = { dir, store, documents, backups };
  harnesses.push(h);
  return h;
};
afterEach(async () => {
  for (const h of harnesses.splice(0)) {
    h.backups.close();
    await h.documents.close();
    h.store.close();
    rmSync(h.dir, { recursive: true, force: true });
  }
});
describe('normal backups', () => {
  it('restores a saved project and its verified original as a new project', async () => {
    const h = open();
    const p = h.store.createProject('保留资料', '');
    const m = h.documents.upload(p.id, 'original.txt', Buffer.from('原始想法'));
    await h.documents.wait(m.id);
    h.backups.save(p.id);
    const entry = h.backups.list(p.id)[0];
    const restored = h.backups.restore(p.id, entry.name);
    const material = h.store.items(restored.id).find((i) => i.kind === 'material')!;
    expect(restored.id).not.toBe(p.id);
    expect(h.documents.read(material.id).toString()).toBe('原始想法');
  });
});
describe('adversarial backups', () => {
  it('refuses an unrestorable export and keeps the last restorable backup', () => {
    const h = open();
    const p = h.store.createProject('容量边界', '');
    h.backups.save(p.id);
    const entry = h.backups.list(p.id)[0];
    const before = readFileSync(join(h.dir, 'backups', p.id, entry.name), 'utf8');
    for (let n = 0; n < 10001; n++) h.store.createItem(p.id, 'artifact', `记录 ${n}`, { content: '内容' });
    expect(() => h.backups.save(p.id)).toThrow();
    expect(h.backups.hasError(p.id)).toBe(true);
    expect(readFileSync(join(h.dir, 'backups', p.id, entry.name), 'utf8')).toBe(before);
    expect(h.store.items(h.backups.restore(p.id, entry.name).id)).toHaveLength(0);
  });
  it('rejects path traversal and preserves the original project', () => {
    const h = open();
    const p = h.store.createProject('范围', '');
    h.backups.save(p.id);
    expect(() => h.backups.restore(p.id, '../../outside')).toThrow('INVALID_BACKUP');
    expect(h.store.projects()).toHaveLength(1);
  });
  it('rejects a corrupted backup before creating a copy', () => {
    const h = open();
    const p = h.store.createProject('校验', '');
    h.backups.save(p.id);
    const e = h.backups.list(p.id)[0];
    const file = join(h.dir, 'backups', p.id, e.name);
    const data = JSON.parse(readFileSync(file, 'utf8'));
    data.project.title = '篡改';
    writeFileSync(file, JSON.stringify(data));
    expect(() => h.backups.restore(p.id, e.name)).toThrow('INTEGRITY_FAILED');
    expect(h.store.projects()).toHaveLength(1);
  });
  it('removes managed backups when permanently deleting a project', () => {
    const h = open();
    const p = h.store.createProject('删除', '');
    h.backups.save(p.id);
    h.backups.remove(p.id);
    expect(h.backups.list(p.id)).toHaveLength(0);
  });
});
