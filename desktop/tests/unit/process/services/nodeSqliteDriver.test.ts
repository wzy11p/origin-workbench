import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeSqliteDriver } from '@process/services/database/drivers/NodeSqliteDriver';
import { runMigrations } from '@process/services/database/migrations';

describe('built-in SQLite driver', () => {
  let db: NodeSqliteDriver;
  beforeEach(() => {
    db = new NodeSqliteDriver(':memory:');
    db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT UNIQUE)');
  });
  afterEach(() => db.close());

  it('normal: commits transactions with bound values and returns their result', () => {
    const insert = db.transaction((body) => db.prepare('INSERT INTO notes(body) VALUES (?)').run(body));
    expect(insert('原始想法')).toMatchObject({ changes: 1, lastInsertRowid: 1 });
    expect(db.prepare('SELECT body FROM notes').all()).toEqual([{ body: '原始想法' }]);
  });

  it('normal: reads scalar and row pragmas and named bindings', () => {
    db.pragma('user_version=25');
    expect(db.pragma('user_version', { simple: true })).toBe(25);
    expect(db.pragma('table_info(notes)')).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'body' })]));
    expect(db.prepare('SELECT $body AS body').get({ $body: '文字' })).toEqual({ body: '文字' });
  });

  it('normal: preserves the selected bytes of binary parameters', () => {
    const bytes = new Uint8Array([99, 65, 66]).subarray(1);
    expect(db.prepare('SELECT ? AS value').get(bytes)).toEqual({ value: new Uint8Array([65, 66]) });
  });

  it('adversarial: rolls back all writes when a transaction throws', () => {
    const failure = new Error('stop transaction');
    const insert = db.transaction(() => {
      db.prepare('INSERT INTO notes(body) VALUES (?)').run('discard');
      throw failure;
    });
    expect(insert).toThrow(failure);
    expect(db.prepare('SELECT * FROM notes').all()).toEqual([]);
  });

  it('adversarial: rolls back a nested transaction while allowing the outer work to commit', () => {
    db.transaction(() => {
      db.prepare('INSERT INTO notes(body) VALUES (?)').run('outer');
      expect(
        db.transaction(() => {
          db.prepare('INSERT INTO notes(body) VALUES (?)').run('inner');
          throw new Error('inner failed');
        })
      ).toThrow('inner failed');
    })();
    expect(db.prepare('SELECT body FROM notes').all()).toEqual([{ body: 'outer' }]);
  });

  it('adversarial: a failed schema migration restores columns and foreign key enforcement', () => {
    db.exec('CREATE TABLE teams (id TEXT); PRAGMA user_version=22');
    expect(() => runMigrations(db, 22, 26)).toThrow(/cron_jobs/);
    expect(db.pragma('table_info(teams)')).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'session_mode' })])
    );
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('adversarial: quoted SQL remains data and invalid bindings fail', () => {
    const body = "'); DROP TABLE notes; --";
    db.prepare('INSERT INTO notes(body) VALUES (?)').run(body);
    expect(db.prepare('SELECT body FROM notes').get()).toEqual({ body });
    expect(() => db.prepare('SELECT ?').get(true)).toThrow(TypeError);
  });

  it('adversarial: closed connections cannot accept new work', () => {
    db.close();
    expect(() => db.prepare('SELECT 1')).toThrow();
  });

  it('adversarial: async results do not commit writes before completion', () => {
    const insert = db.transaction(() => {
      db.prepare('INSERT INTO notes(body) VALUES (?)').run('discard');
      return Promise.resolve('done');
    });
    expect(insert).toThrow('must be synchronous');
    expect(db.prepare('SELECT * FROM notes').all()).toEqual([]);
  });
});
