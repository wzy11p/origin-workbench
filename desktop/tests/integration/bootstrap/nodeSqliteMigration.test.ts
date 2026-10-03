import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@process/utils', () => ({
  ensureDirectory: (path: string) => mkdirSync(path, { recursive: true }),
  getDataPath: () => {
    throw new Error('Tests must supply a temporary data path');
  },
}));

import { runLegacyDatabaseMigrations } from '@process/services/database/runLegacyDatabaseMigrations';

describe('legacy migration with built-in SQLite', () => {
  let directory: string;
  let path: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'origin-migration-'));
    path = join(directory, 'catalog.db');
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('normal: migrates a real v25 database and retains existing content', async () => {
    const seed = new DatabaseSync(path);
    seed.exec(
      "PRAGMA user_version=25; CREATE TABLE saved_notes (body TEXT); INSERT INTO saved_notes VALUES ('保留我的原始想法');"
    );
    seed.close();
    const result = await runLegacyDatabaseMigrations(path);
    const check = new DatabaseSync(path);
    try {
      expect(result).toMatchObject({ fromVersion: 25, toVersion: 26, migrated: true });
      expect(check.prepare('SELECT body FROM saved_notes').get()).toMatchObject({ body: '保留我的原始想法' });
      expect(check.prepare("SELECT name FROM sqlite_master WHERE name='acp_session'").get()).toBeDefined();
    } finally {
      check.close();
    }
  });

  it('normal: leaves a missing catalog absent', async () => {
    expect(await runLegacyDatabaseMigrations(path)).toMatchObject({ skipped: true });
    expect(() => readFileSync(path)).toThrow();
  });

  it('adversarial: reports a corrupt database without replacing its bytes', async () => {
    const corrupt = Buffer.from('this is not a sqlite database');
    writeFileSync(path, corrupt);
    await expect(runLegacyDatabaseMigrations(path)).rejects.toThrow(/not a database|malformed/i);
    expect(readFileSync(path)).toEqual(corrupt);
  });
});
