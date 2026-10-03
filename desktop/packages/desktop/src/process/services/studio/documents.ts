import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { extname, join } from 'node:path';
import type { StudioItem, StudioPack, StudioProject } from '../../../common/types/studio';
import type { StudioStore } from './store';

const EXTENSIONS = new Set([
  '.pdf',
  '.docx',
  '.pptx',
  '.xlsx',
  '.csv',
  '.md',
  '.txt',
  '.html',
  '.htm',
  '.png',
  '.jpg',
  '.jpeg',
]);
const sha = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex');
type Job = { controller: AbortController; promise: Promise<void> };
type Attachment = { extension: string; sha256: string; data: string };
type FilePack = StudioPack & { files: Record<string, Attachment> };

/** Bounded local parsing jobs. No caller-supplied paths or shell commands are executed. */
export class StudioDocuments {
  private jobs = new Map<string, Job>();
  private queue: (() => Promise<void>)[] = [];
  private running = 0;
  private closing = false;
  private files: string;
  constructor(
    private root: string,
    dataDir: string,
    private store: StudioStore
  ) {
    this.files = join(dataDir, 'files');
    mkdirSync(this.files, { recursive: true, mode: 0o700 });
    for (const filename of readdirSync(this.files)) {
      if (filename.endsWith('.upload')) {
        rmSync(join(this.files, filename), { force: true });
        continue;
      }
      const id = filename.slice(0, 36);
      if (!/^[a-f0-9-]{36}$/.test(id)) continue;
      try {
        this.store.getItem(id);
      } catch {
        rmSync(join(this.files, filename), { force: true });
      }
    }
  }
  private path(item: StudioItem): string {
    const extension = String(item.body.fileExtension);
    if (item.kind !== 'material' || !EXTENSIONS.has(extension) || !/^[a-f0-9-]{36}$/.test(item.id))
      throw new Error('FILE_NOT_FOUND');
    return join(this.files, `${item.id}${extension}`);
  }
  read(id: string): Buffer {
    const item = this.store.getItem(id);
    const file = this.path(item);
    if (!existsSync(file)) throw new Error('FILE_NOT_FOUND');
    const bytes = readFileSync(file);
    if (bytes.length !== item.body.fileSize || sha(bytes) !== item.body.fileHash) throw new Error('INTEGRITY_FAILED');
    return bytes;
  }
  upload(projectId: string, filename: string, data: Buffer): StudioItem {
    if (this.closing) throw new Error('SERVICE_STOPPED');
    const extension = extname(filename).toLowerCase();
    if (!EXTENSIONS.has(extension)) throw new Error('UNSUPPORTED_FORMAT');
    if (!data.length || data.length > 25 * 1024 * 1024) throw new Error('FILE_TOO_LARGE');
    if (
      !filename ||
      filename.length > 160 ||
      [...filename].some((char) => char.charCodeAt(0) < 32) ||
      /[\\/]/.test(filename)
    )
      throw new Error('INVALID_FILENAME');
    let written: string | undefined;
    let item: StudioItem;
    try {
      item = this.store.createItem(
        projectId,
        'material',
        filename,
        {
          filename,
          fileExtension: extension,
          fileSize: data.length,
          fileHash: sha(data),
          content: '',
        },
        (created) => {
          written = this.path(created);
          this.writeOriginal(written, data);
        }
      );
    } catch {
      if (written) {
        try {
          rmSync(written, { force: true });
        } catch {
          /* The parent can itself be unwritable. */
        }
      }
      throw new Error('ORIGINAL_WRITE_FAILED');
    }
    return this.parse(item.id);
  }
  private writeOriginal(destination: string, data: Buffer): void {
    const temporary = `${destination}.upload`;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporary, 'wx', 0o600);
      writeFileSync(descriptor, data);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporary, destination);
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      try {
        rmSync(temporary, { force: true });
      } catch {
        /* Best effort; a startup recovery pass removes interrupted writes. */
      }
      throw error;
    }
  }
  parse(id: string): StudioItem {
    if (this.jobs.has(id)) throw new Error('TASK_RUNNING');
    if (this.closing) throw new Error('SERVICE_STOPPED');
    const item = this.store.getItem(id);
    const file = this.path(item);
    this.read(id);
    const queued = this.store.systemUpdate(id, item.version, {
      status: 'queued',
      body: { ...item.body, error: undefined },
    });
    const controller = new AbortController();
    let finish: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.jobs.set(id, { controller, promise });
    this.queue.push(async () => {
      try {
        if (controller.signal.aborted) return;
        const current = this.store.getItem(id);
        this.store.systemUpdate(id, current.version, { status: 'parsing' });
        const parsed = await this.runWorker(file, controller.signal);
        if (controller.signal.aborted) return;
        this.read(id);
        const latest = this.store.getItem(id);
        this.store.systemUpdate(id, latest.version, {
          status: parsed.status === 'success' ? 'ready' : 'partial',
          body: {
            ...latest.body,
            content: parsed.content,
            blocks: parsed.blocks,
            parser: parsed.parser,
            parseErrors: parsed.errors,
            parsedAt: Date.now(),
          },
        });
      } catch (error) {
        try {
          const current = this.store.getItem(id);
          this.store.systemUpdate(id, current.version, {
            status: controller.signal.aborted ? 'cancelled' : 'failed',
            body: {
              ...current.body,
              error: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'PARSE_FAILED',
            },
          });
        } catch {
          /* A deleted project cannot receive a late result. */
        }
      } finally {
        this.jobs.delete(id);
        finish();
      }
    });
    this.pump();
    return queued;
  }
  private pump(): void {
    while (this.running < 2 && this.queue.length) {
      const next = this.queue.shift();
      if (!next) return;
      this.running++;
      void next().finally(() => {
        this.running--;
        this.pump();
      });
    }
  }
  private runWorker(
    file: string,
    signal: AbortSignal
  ): Promise<{ content: string; blocks: unknown[]; parser: string; status: string; errors: unknown[] }> {
    return new Promise((resolve, reject) => {
      // These native/office pipelines do not require downloaded AI models. An inherited
      // artifacts directory makes even Markdown fail when that directory is absent.
      const workerEnv: NodeJS.ProcessEnv = { ...process.env, PYTHONUNBUFFERED: '1' };
      delete workerEnv.DOCLING_ARTIFACTS_PATH;
      const child = spawn(
        join(this.root, 'runtime/docling-env/bin/python'),
        [join(this.root, 'workers/parse_document.py'), file],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          signal,
          env: workerEnv,
        }
      );
      const chunks: Buffer[] = [];
      let size = 0;
      let limit = false;
      const timer = setTimeout(() => {
        limit = true;
        child.kill('SIGKILL');
      }, 120_000);
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 24_000_000) {
          limit = true;
          child.kill('SIGKILL');
        } else chunks.push(chunk);
      });
      child.stderr.on('data', () => undefined);
      child.once('error', () => {
        clearTimeout(timer);
        reject(new Error(signal.aborted ? 'CANCELLED' : 'PARSER_UNAVAILABLE'));
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (signal.aborted) return reject(new Error('CANCELLED'));
        if (limit) return reject(new Error('PARSE_LIMIT'));
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          if (code !== 0 || typeof data.content !== 'string' || !Array.isArray(data.blocks))
            throw new Error('PARSE_FAILED');
          if (data.content.length > 2_000_000 || JSON.stringify(data.blocks).length > 2_000_000)
            throw new Error('PARSE_LIMIT');
          resolve({
            content: data.content,
            blocks: data.blocks,
            parser: String(data.parser),
            status: String(data.status),
            errors: Array.isArray(data.errors) ? data.errors : [],
          });
        } catch (error) {
          reject(new Error(error instanceof Error && error.message === 'PARSE_LIMIT' ? 'PARSE_LIMIT' : 'PARSE_FAILED'));
        }
      });
    });
  }
  cancel(id: string): StudioItem {
    const item = this.store.getItem(id);
    const job = this.jobs.get(id);
    if (!job) throw new Error('TASK_NOT_RUNNING');
    job.controller.abort();
    return this.store.systemUpdate(id, item.version, { status: 'cancelled' });
  }
  async wait(id: string): Promise<void> {
    await this.jobs.get(id)?.promise;
  }
  async close(): Promise<void> {
    this.closing = true;
    for (const job of this.jobs.values()) job.controller.abort();
    await Promise.all([...this.jobs.values()].map((j) => j.promise));
  }
  export(id: string): FilePack {
    const { checksum: _checksum, ...payload } = this.store.exportProject(id);
    const files: Record<string, Attachment> = {};
    let size = 0;
    for (const item of payload.items) {
      if (item.kind !== 'material' || !item.body.fileExtension) continue;
      const data = this.read(item.id);
      size += data.length;
      if (size > 100 * 1024 * 1024) throw new Error('EXPORT_TOO_LARGE');
      files[item.id] = { extension: String(item.body.fileExtension), sha256: sha(data), data: data.toString('base64') };
    }
    const complete = { ...payload, files };
    const text = JSON.stringify(complete);
    if (Buffer.byteLength(text) + 100 > 160_000_000) throw new Error('EXPORT_TOO_LARGE');
    return { ...complete, checksum: createHash('sha256').update(text).digest('hex') };
  }
  import(input: unknown): StudioProject {
    const pack = input as FilePack;
    const files = pack?.files ?? {};
    const buffers = new Map<string, Buffer>();
    let size = 0;
    for (const [id, file] of Object.entries(files)) {
      if (
        !file ||
        !EXTENSIONS.has(file.extension) ||
        typeof file.data !== 'string' ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)
      )
        throw new Error('INVALID_PACKAGE');
      const buffer = Buffer.from(file.data, 'base64');
      size += buffer.length;
      if (size > 100 * 1024 * 1024 || sha(buffer) !== file.sha256) throw new Error('INTEGRITY_FAILED');
      const material = pack.items?.find(
        (i) => i.id === id && i.kind === 'material' && i.body.fileExtension === file.extension
      );
      if (!material) throw new Error('INVALID_PACKAGE');
      if (material.body.fileHash !== file.sha256 || material.body.fileSize !== buffer.length)
        throw new Error('INTEGRITY_FAILED');
      buffers.set(id, buffer);
    }
    for (const item of pack?.items ?? [])
      if (item.kind === 'material' && item.body.fileExtension && !buffers.has(item.id))
        throw new Error('MISSING_ATTACHMENT');
    const written: string[] = [];
    try {
      return this.store.importProject(input, (ids) => {
        for (const [oldId, buffer] of buffers) {
          const id = ids.get(oldId);
          if (!id) throw new Error('INVALID_PACKAGE');
          const path = join(this.files, `${id}${files[oldId].extension}`);
          this.writeOriginal(path, buffer);
          written.push(path);
        }
      });
    } catch (error) {
      written.forEach((path) => rmSync(path, { force: true }));
      throw error;
    }
  }
  removeFiles(items: StudioItem[]): void {
    for (const item of items) {
      if (item.kind !== 'material' || !item.body.fileExtension) continue;
      this.jobs.get(item.id)?.controller.abort();
      rmSync(this.path(item), { force: true });
    }
  }
}
