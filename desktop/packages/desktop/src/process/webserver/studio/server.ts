import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import type { StudioConnection } from '../../../common/types/studio';
import { StudioStore } from '../../services/studio/store';
import { StudioDocuments } from '../../services/studio/documents';
import { MethodLibrary } from '../../services/studio/methods';
import { StudioModels } from '../../services/studio/models';
import { StudioBackups } from '../../services/studio/backups';
import { routeStudio } from './routes';

export type StudioHostOptions = { root: string; dataDir: string; backendPort: number; allowedOrigins?: string[] };
export type StudioContext = {
  store: StudioStore;
  documents: StudioDocuments;
  methods: MethodLibrary;
  models: StudioModels;
  backups: StudioBackups;
  options: StudioHostOptions;
};
export function json(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
export async function readBody(request: IncomingMessage, limit = 8_000_000): Promise<Buffer> {
  if (Number(request.headers['content-length']) > limit) throw new Error('PAYLOAD_TOO_LARGE');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const data = Buffer.from(chunk);
    size += data.length;
    if (size > limit) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(data);
  }
  return Buffer.concat(chunks);
}
export async function readJson(request: IncomingMessage, limit?: number): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('INVALID_CONTENT_TYPE');
  const body = await readBody(request, limit);
  try {
    const data: unknown = JSON.parse(body.toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch {
    throw new Error('INVALID_JSON');
  }
}

/** An authenticated, loopback-only boundary between Electron and local product services. */
export async function startStudioServer(options: StudioHostOptions) {
  const store = new StudioStore(join(options.dataDir, 'studio.db'));
  const documents = new StudioDocuments(options.root, options.dataDir, store);
  const methods = new MethodLibrary(join(options.root, 'vendor/pm-skills'));
  const models = new StudioModels(options.backendPort, store);
  const token = randomBytes(32).toString('hex');
  const origins = new Set(['null', ...(options.allowedOrigins ?? [])]);
  const backups = new StudioBackups(options.dataDir, store, documents);
  const context: StudioContext = { store, documents, methods, models, backups, options };
  const server = createServer((request, response) => {
    void (async () => {
      response.setHeader('X-Content-Type-Options', 'nosniff');
      const host = request.headers.host;
      if (host !== `127.0.0.1:${connection.port}`) {
        json(response, { error: 'FORBIDDEN_HOST' }, 403);
        return;
      }
      const origin = request.headers.origin;
      if (origin && !origins.has(origin)) {
        json(response, { error: 'FORBIDDEN_ORIGIN' }, 403);
        return;
      }
      if (origin) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
      }
      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key',
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'Access-Control-Max-Age': '600',
        });
        response.end();
        return;
      }
      const auth = request.headers.authorization ?? '';
      const expected = `Bearer ${token}`;
      if (auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
        json(response, { error: 'UNAUTHORIZED' }, 401);
        return;
      }
      try {
        await routeStudio(request, response, context);
      } catch (error) {
        const code =
          error instanceof Error && /^[A-Z][A-Z_0-9]{1,80}$/.test(error.message) ? error.message : 'INTERNAL_ERROR';
        const status =
          code.includes('CONFLICT') || code === 'TASK_RUNNING'
            ? 409
            : code.includes('NOT_FOUND')
              ? 404
              : code === 'INTERNAL_ERROR'
                ? 500
                : code.includes('TOO_LARGE')
                  ? 413
                  : 400;
        if (!response.headersSent) json(response, { error: code }, status);
        else response.end();
      }
    })().catch(() => {
      if (!response.headersSent) json(response, { error: 'INTERNAL_ERROR' }, 500);
      else response.end();
    });
  });
  server.requestTimeout = 150_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 40;
  const connection: StudioConnection = { port: 0, token };
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('LISTEN_FAILED'));
      connection.port = address.port;
      resolve();
    });
  });
  let closed = false;
  return {
    connection,
    store,
    documents,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      backups.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await documents.close();
      await models.close();
      store.close();
    },
  };
}
