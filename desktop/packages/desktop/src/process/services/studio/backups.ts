import type { StudioStore } from './store';
import type { StudioDocuments } from './documents';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, rmSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { StudioProject } from '../../../common/types/studio';
/** Managed project snapshots contain no provider credentials and are never sent off-device. */
export class StudioBackups {
  private root: string;
  private timer: ReturnType<typeof setInterval>;
  private initial: ReturnType<typeof setTimeout>;
  private failed = new Set<string>();
  constructor(
    directory: string,
    private store: StudioStore,
    private documents: StudioDocuments
  ) {
    this.root = join(directory, 'backups');
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const saveAll = (): void => {
      for (const p of store.projects()) {
        try {
          this.save(p.id);
        } catch {
          this.failed.add(p.id);
        }
      }
    };
    this.initial = setTimeout(saveAll, 30_000);
    this.initial.unref();
    this.timer = setInterval(saveAll, 5 * 60_000);
    this.timer.unref();
  }
  private folder(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('INVALID_BACKUP');
    return join(this.root, id);
  }
  save(id: string): void {
    const folder = this.folder(id);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const file = join(folder, `${day}.origin.json`);
    const temporary = `${file}.tmp`;
    try {
      const pack = this.documents.export(id);
      writeFileSync(temporary, JSON.stringify(pack), { mode: 0o600, flush: true });
      renameSync(temporary, file);
      this.failed.delete(id);
    } catch {
      try {
        rmSync(temporary, { force: true });
      } catch {
        /* Next successful backup can clean the file. */
      }
      this.failed.add(id);
      throw new Error('BACKUP_FAILED');
    }
    for (const old of this.list(id).slice(7)) rmSync(join(folder, old.name), { force: true });
  }
  list(id: string): { name: string; updatedAt: number; size: number }[] {
    this.store.project(id);
    const folder = this.folder(id);
    if (!existsSync(folder)) return [];
    return readdirSync(folder)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.origin\.json$/.test(name))
      .sort()
      .reverse()
      .map((name) => {
        const s = statSync(join(folder, name));
        return { name, updatedAt: s.mtimeMs, size: s.size };
      });
  }
  restore(id: string, name: string): StudioProject {
    this.store.project(id);
    if (!/^\d{4}-\d{2}-\d{2}\.origin\.json$/.test(name)) throw new Error('INVALID_BACKUP');
    const file = join(this.folder(id), name);
    if (!existsSync(file)) throw new Error('NOT_FOUND');
    if (statSync(file).size > 160_000_000) throw new Error('PAYLOAD_TOO_LARGE');
    const pack = JSON.parse(readFileSync(file, 'utf8')) as { project?: { id: string } };
    if (pack.project?.id !== id) throw new Error('INVALID_BACKUP');
    return this.documents.import(pack);
  }
  hasError(id: string): boolean {
    return this.failed.has(id);
  }
  remove(id: string): void {
    rmSync(this.folder(id), { recursive: true, force: true });
    this.failed.delete(id);
  }
  close(): void {
    clearInterval(this.timer);
    clearTimeout(this.initial);
  }
}
