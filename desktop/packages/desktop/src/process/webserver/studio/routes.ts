import type { IncomingMessage, ServerResponse } from 'node:http';
import type { StudioBody, StudioKind, StudioPatch, StudioProject } from '../../../common/types/studio';
import { validateCanvas as validateCanvasBody } from '../../../common/studio/canvas';
import { compilePrd, workflowBody } from '../../services/studio/methods';
import { resolveBlueprint } from '../../../common/studio/blueprint';
import { buildHandoff } from '../../services/studio/handoff';
import { json, readBody, readJson, type StudioContext } from './server';

const str = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('VALIDATION_FAILED');
  return value;
};
const version = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new Error('VALIDATION_FAILED');
  return value;
};
const record = (value: unknown): StudioBody => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED');
  return value as StudioBody;
};
const validateCanvas = (kind: string, body: StudioBody): void => {
  if (kind === 'canvas') validateCanvasBody(body);
};

/** Explicit routes keep confirmation and trusted parser updates out of generic writes. */
export async function routeStudio(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: StudioContext
): Promise<void> {
  const { store, documents, methods } = ctx;
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const [area, id, action] = parts;
  const verb = request.method ?? 'GET';
  const output = (value: unknown): void => json(response, value);
  const mutate = <T>(body: unknown, fn: () => T): T => {
    const key = request.headers['idempotency-key'];
    return typeof key === 'string' ? store.idempotent(key, { path: url.pathname, verb, body }, fn) : fn();
  };
  if (area === 'health' && verb === 'GET') {
    output({ status: 'ok', product: '原点工作台', methods: methods.list().length });
    return;
  }
  if (area === 'methods' && verb === 'GET') {
    output(id ? methods.get(id) : methods.list());
    return;
  }
  if (area === 'models' && verb === 'GET') {
    output(await ctx.models.list());
    return;
  }
  if (area === 'projects' && !id) {
    if (verb === 'GET') {
      output(store.projects());
      return;
    }
    if (verb === 'POST') {
      const b = await readJson(request);
      output(mutate(b, () => store.createProject(str(b.title), str(b.intent ?? ''))));
      return;
    }
  }
  if (area === 'import' && verb === 'POST') {
    output(documents.import(await readJson(request, 160_000_000)));
    return;
  }
  if (area === 'projects' && id && !action) {
    if (verb === 'GET') {
      output(store.project(id));
      return;
    }
    if (verb === 'PATCH') {
      const b = await readJson(request);
      const patch: Partial<Pick<StudioProject, 'title' | 'intent' | 'stage' | 'archived'>> = {};
      for (const key of ['title', 'intent', 'stage'] as const) if (b[key] !== undefined) patch[key] = str(b[key]);
      if (b.archived !== undefined) {
        if (typeof b.archived !== 'boolean') throw new Error('VALIDATION_FAILED');
        patch.archived = b.archived;
      }
      output(store.updateProject(id, patch));
      return;
    }
    if (verb === 'DELETE') {
      const b = await readJson(request);
      const items = store.items(id);
      store.deleteProject(id, str(b.confirmation));
      documents.removeFiles(items);
      ctx.backups.remove(id);
      output({ deleted: true });
      return;
    }
  }
  if ((area === 'projects' && id && action === 'items') || (area === 'inbox' && id === 'items')) {
    const projectId = area === 'inbox' ? null : id;
    if (verb === 'GET') {
      output(store.items(projectId));
      return;
    }
    if (verb === 'POST') {
      const b = await readJson(request);
      const body = record(b.body);
      const kind = str(b.kind) as StudioKind;
      if (kind === 'material' && ['fileExtension', 'fileHash', 'fileSize', 'filename'].some((key) => key in body))
        throw new Error('INVALID_FILE_METADATA');
      validateCanvas(kind, body);
      output(mutate(b, () => store.createItem(projectId, kind, str(b.title), body)));
      return;
    }
  }
  if (area === 'projects' && id) {
    if (action === 'blueprint' && verb === 'POST') {
      const b = await readJson(request);
      output(
        mutate(b, () => {
          const current = resolveBlueprint(store.project(id), store.items(id)).item;
          if (b.version !== (current?.version ?? 0)) throw new Error('VERSION_CONFLICT');
          const fields = { ...record(current?.body.fields ?? {}), ...record(b.fields) };
          return current
            ? store.updateItem(current.id, current.version, { body: { ...current.body, fields } })
            : store.createItem(id, 'blueprint', '产品蓝图', { fields });
        })
      );
      return;
    }
    if (action === 'handoff' && verb === 'GET') {
      const bytes = await buildHandoff(documents.export(id), url.searchParams.get('artifact') ?? '');
      response.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="origin-handoff-${id}.zip"`,
        'Content-Length': bytes.length,
        'Cache-Control': 'no-store',
      });
      response.end(bytes);
      return;
    }
    if (action === 'backups') {
      if (verb === 'GET') {
        output({ entries: ctx.backups.list(id), failed: ctx.backups.hasError(id) });
        return;
      }
      if (verb === 'POST') {
        const b = await readJson(request);
        if (b.restore) output(ctx.backups.restore(id, str(b.restore)));
        else {
          ctx.backups.save(id);
          output({ saved: true });
        }
        return;
      }
    }
    if (action === 'review' && verb === 'POST') {
      const b = await readJson(request);
      output(await ctx.models.start(id, b.prompt, b.targets));
      return;
    }
    if (action === 'upload' && verb === 'POST') {
      store.project(id);
      const bytes = await readBody(request, 25 * 1024 * 1024);
      output(documents.upload(id, url.searchParams.get('name') ?? '', bytes));
      return;
    }
    if (action === 'export' && verb === 'GET') {
      response.setHeader('Content-Disposition', `attachment; filename="origin-${id}.json"`);
      output(documents.export(id));
      return;
    }
    if (action === 'compile' && verb === 'POST') {
      const input = await readJson(request);
      output(
        mutate(input, () => {
          const all = store.items(id);
          const previous = all
            .filter((i) => i.kind === 'artifact' && i.status !== 'archived')
            .toSorted((a, b) => b.createdAt - a.createdAt)[0];
          const body = compilePrd(store.project(id), all, [
            ...store.items(null, 'preference'),
            ...store.items(id, 'preference'),
          ]);
          if (previous) body.previousArtifact = { id: previous.id, version: previous.version };
          return store.createItem(id, 'artifact', `${store.project(id).title} · PRD`, body);
        })
      );
      return;
    }
    if (action === 'workflows' && verb === 'POST') {
      const b = await readJson(request);
      const method = methods.get(str(b.methodId));
      const body = workflowBody(method, b.answers ?? [], b.complete === true);
      output(mutate(b, () => store.createItem(id, 'workflow', method.title, body)));
      return;
    }
  }
  if (area === 'items' && id) {
    if (action === 'retry-review' && verb === 'POST') {
      const b = await readJson(request);
      if (typeof b.index !== 'number') throw new Error('VALIDATION_FAILED');
      output(await ctx.models.retry(id, b.index));
      return;
    }
    if (action === 'cancel-review' && verb === 'POST') {
      ctx.models.cancel(id);
      output({ cancelled: true });
      return;
    }
    if (!action && verb === 'GET') {
      output(store.getItem(id));
      return;
    }
    if (!action && verb === 'PATCH') {
      const b = await readJson(request);
      const item = store.getItem(id);
      const patch: StudioPatch = {};
      if (b.title !== undefined) patch.title = str(b.title);
      if (b.status !== undefined) patch.status = str(b.status);
      if (b.body !== undefined) {
        patch.body = record(b.body);
        validateCanvas(item.kind, patch.body);
        if (item.kind === 'material')
          for (const key of ['fileExtension', 'fileHash', 'fileSize', 'filename'])
            if (patch.body[key] !== item.body[key]) throw new Error('ORIGINAL_IMMUTABLE');
      }
      output(store.updateItem(id, version(b.version), patch));
      return;
    }
    if (action === 'versions' && verb === 'GET') {
      output(store.versions(id));
      return;
    }
    if (action === 'confirm' && verb === 'POST') {
      const b = await readJson(request);
      output(store.confirmItem(id, version(b.version)));
      return;
    }
    if (action === 'parse' && verb === 'POST') {
      output(documents.parse(id));
      return;
    }
    if (action === 'cancel' && verb === 'POST') {
      output(documents.cancel(id));
      return;
    }
    if (action === 'file' && verb === 'GET') {
      const item = store.getItem(id);
      const bytes = documents.read(id);
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(String(item.body.filename ?? item.title))}`,
        'Content-Length': bytes.length,
        'Cache-Control': 'no-store',
      });
      response.end(bytes);
      return;
    }
    if (action === 'restore' && verb === 'POST') {
      const b = await readJson(request);
      const snapshot = store.versions(id).find((v) => v.version === version(b.restoreVersion))?.snapshot;
      if (!snapshot) throw new Error('NOT_FOUND');
      output(store.updateItem(id, version(b.version), { title: snapshot.title, body: snapshot.body, status: 'draft' }));
      return;
    }
    if (action === 'workflow' && verb === 'POST') {
      const b = await readJson(request);
      const item = store.getItem(id);
      if (item.kind !== 'workflow') throw new Error('INVALID_STATE');
      const method = methods.get(str(item.body.methodId));
      if (method.version !== item.body.methodVersion) throw new Error('METHOD_VERSION_CONFLICT');
      output(store.updateItem(id, version(b.version), { body: workflowBody(method, b.answers, b.complete === true) }));
      return;
    }
    if (action === 'assign' && verb === 'POST') {
      const b = await readJson(request);
      const item = store.getItem(id);
      if (item.kind !== 'capture' || item.projectId || item.status !== 'unprocessed') throw new Error('INVALID_STATE');
      const saved = mutate(b, () => {
        const copy = store.createItem(str(b.projectId), 'capture', item.title, { ...item.body, originalCaptureId: id });
        store.systemUpdate(id, item.version, {
          status: 'processed',
          body: { ...item.body, assignedProjectId: b.projectId },
        });
        return copy;
      });
      output(saved);
      return;
    }
  }
  throw new Error('NOT_FOUND');
}
