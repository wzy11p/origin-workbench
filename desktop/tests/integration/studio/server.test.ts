import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { startStudioServer } from '../../../packages/desktop/src/process/webserver/studio/server';

type Host = Awaited<ReturnType<typeof startStudioServer>>;
let host: Host;
let temp: string;
const root = resolve(process.cwd(), '..');
beforeEach(async () => {
  temp = mkdtempSync(join(tmpdir(), 'origin-http-'));
  host = await startStudioServer({ root, dataDir: temp, backendPort: 4319 });
});
afterEach(async () => {
  await host?.close();
  rmSync(temp, { recursive: true, force: true });
});
async function call(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${host.connection.port}${path}`, {
    method,
    headers: { Authorization: `Bearer ${host.connection.token}`, 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
describe('normal studio HTTP', () => {
  it('saves one blueprint and keeps a hand-edited PRD when compiling the next draft', async () => {
    const p = host.store.createProject('连续版本', '原话');
    const saved = await (
      await call(`/projects/${p.id}/blueprint`, 'POST', { version: 0, fields: { success: '20秒完成一笔' } })
    ).json();
    expect(saved.body?.fields.success).toBe('20秒完成一笔');
    const first = await (await call(`/projects/${p.id}/compile`, 'POST', {})).json();
    host.store.updateItem(first.id, first.version, { body: { ...first.body, content: '手写内容需要保留' } });
    const second = await (await call(`/projects/${p.id}/compile`, 'POST', {})).json();
    expect(host.store.getItem(first.id).body.content).toBe('手写内容需要保留');
    expect(second.body.previousArtifact).toEqual({ id: first.id, version: 2 });
  });
  it('creates a project and stores an idea through authenticated endpoints', async () => {
    const p = await (await call('/projects', 'POST', { title: '自己的产品', intent: '个人创作' })).json();
    const item = await (
      await call(`/projects/${p.id}/items`, 'POST', {
        kind: 'capture',
        title: '原话',
        body: { content: '我需要保存自己的想法' },
      })
    ).json();
    expect(item.version).toBe(1);
    expect((await (await call(`/projects/${p.id}/items`)).json())[0].body.content).toBe('我需要保存自己的想法');
  });
  it('accepts an original file and finishes a real parser job', async () => {
    const p = await (await call('/projects', 'POST', { title: '资料', intent: '' })).json();
    const response = await fetch(`http://127.0.0.1:${host.connection.port}/projects/${p.id}/upload?name=notes.md`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${host.connection.token}`, 'Content-Type': 'application/octet-stream' },
      body: '# 原点资料正文\n\n我希望资料和决定放在一起。',
    });
    const item = await response.json();
    await host.documents.wait(item.id);
    const parsed = await (await call(`/items/${item.id}`)).json();
    expect(parsed.status).toBe('ready');
    expect(parsed.body.content).toContain('我希望资料和决定放在一起。');
    expect(parsed.body.parser).toContain('Docling');
  }, 30000);
  it('deduplicates a repeated create request', async () => {
    const headers = { 'Idempotency-Key': 'create-one' };
    const input = { title: '只保存一次', intent: '' };
    const a = await (await call('/projects', 'POST', input, headers)).json();
    const b = await (await call('/projects', 'POST', input, headers)).json();
    expect(a.id).toBe(b.id);
    expect(await (await call('/projects')).json()).toHaveLength(1);
  });
});
describe('adversarial studio HTTP', () => {
  it('refuses a stale blueprint write without losing the current field', async () => {
    const p = host.store.createProject('蓝图冲突', '');
    await call(`/projects/${p.id}/blueprint`, 'POST', { version: 0, fields: { success: '已保存' } });
    const stale = await call(`/projects/${p.id}/blueprint`, 'POST', { version: 0, fields: { success: '旧窗口写入' } });
    expect(stale.status).toBe(409);
    expect(host.store.items(p.id, 'blueprint')[0]?.body.fields).toEqual({ success: '已保存' });
  });
  it('retains an unreadable original and records parser failure without inventing content', async () => {
    const p = await (await call('/projects', 'POST', { title: '损坏资料', intent: '' })).json();
    const bytes = 'not a real pdf';
    const response = await fetch(`http://127.0.0.1:${host.connection.port}/projects/${p.id}/upload?name=broken.pdf`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${host.connection.token}`, 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
    const item = await response.json();
    await host.documents.wait(item.id);
    const parsed = await (await call(`/items/${item.id}`)).json();
    expect(parsed.status).toBe('failed');
    expect(parsed.body.content).toBe('');
    expect(host.documents.read(item.id).toString()).toBe(bytes);
  }, 30000);
  it('rejects requests without the private session token', async () => {
    expect((await fetch(`http://127.0.0.1:${host.connection.port}/projects`)).status).toBe(401);
  });
  it('rejects a foreign browser origin even with a token', async () => {
    expect((await call('/projects', 'GET', undefined, { Origin: 'https://evil.example' })).status).toBe(403);
  });
  it('rejects malformed JSON without exposing internal details', async () => {
    const r = await fetch(`http://127.0.0.1:${host.connection.port}/projects`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${host.connection.token}`, 'Content-Type': 'application/json' },
      body: '{',
    });
    expect(r.status).toBe(400);
    expect(await r.text()).toBe('{"error":"INVALID_JSON"}');
  });
  it('cannot force a preference into a confirmed state', async () => {
    const i = await (
      await call('/inbox/items', 'POST', { kind: 'preference', title: '我的偏好', body: { content: '简约' } })
    ).json();
    expect((await call(`/items/${i.id}`, 'PATCH', { version: i.version, status: 'confirmed' })).status).toBe(400);
  });
  it('rejects executable uploads before creating a material', async () => {
    const p = await (await call('/projects', 'POST', { title: '安全', intent: '' })).json();
    const r = await fetch(`http://127.0.0.1:${host.connection.port}/projects/${p.id}/upload?name=../../run.sh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${host.connection.token}` },
      body: 'echo attack',
    });
    expect(r.status).toBe(400);
    expect(await (await call(`/projects/${p.id}/items`)).json()).toHaveLength(0);
  });
  it('detects a reused idempotency key with different input', async () => {
    const headers = { 'Idempotency-Key': 'collision' };
    await call('/projects', 'POST', { title: 'A', intent: '' }, headers);
    expect((await call('/projects', 'POST', { title: 'B', intent: '' }, headers)).status).toBe(409);
  });
});
