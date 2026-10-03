import { Buffer } from 'node:buffer';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import type { ISqliteDriver, IStatement } from './ISqliteDriver';

function input(value: unknown): SQLInputValue {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return value;
  }
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('SQLite parameters must be strings, numbers, bigints, blobs, or null.');
}

function bindings(args: unknown[]): { named?: Record<string, SQLInputValue>; positional: SQLInputValue[] } {
  const first = args[0];
  if (first !== null && typeof first === 'object' && !ArrayBuffer.isView(first)) {
    if (Object.getPrototypeOf(first) !== Object.prototype && Object.getPrototypeOf(first) !== null) {
      throw new TypeError('Named SQLite parameters must be a plain object.');
    }
    return {
      named: Object.fromEntries(Object.entries(first).map(([key, value]) => [key, input(value)])),
      positional: args.slice(1).map(input),
    };
  }
  return { positional: args.map(input) };
}

class NodeSqliteStatement implements IStatement {
  constructor(private readonly statement: StatementSync) {}

  get(...args: unknown[]): unknown {
    const { named, positional } = bindings(args);
    return named ? this.statement.get(named, ...positional) : this.statement.get(...positional);
  }

  all(...args: unknown[]): unknown[] {
    const { named, positional } = bindings(args);
    return named ? this.statement.all(named, ...positional) : this.statement.all(...positional);
  }

  run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    const { named, positional } = bindings(args);
    const result = named ? this.statement.run(named, ...positional) : this.statement.run(...positional);
    return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
  }
}

/** SQLite adapter for the synchronous migration contract, without native addons. */
export class NodeSqliteDriver implements ISqliteDriver {
  private readonly db: DatabaseSync;
  private nextSavepoint = 0;
  private closed = false;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: false });
  }

  prepare(sql: string): IStatement {
    return new NodeSqliteStatement(this.db.prepare(sql));
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  pragma(sql: string, options?: { simple?: boolean }): unknown {
    const rows = this.db.prepare(`PRAGMA ${sql}`).all();
    return options?.simple ? Object.values(rows[0] ?? {})[0] : rows;
  }

  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
    return (...args) => {
      // SAVEPOINT also supports nested transactions without committing outer work.
      const name = `origin_migration_${this.nextSavepoint++}`;
      this.db.exec(`SAVEPOINT ${name}`);
      try {
        const result = fn(...args);
        if (
          result !== null &&
          (typeof result === 'object' || typeof result === 'function') &&
          'then' in result &&
          typeof result.then === 'function'
        ) {
          throw new TypeError('SQLite transactions must be synchronous.');
        }
        this.db.exec(`RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (error) {
        try {
          this.db.exec(`ROLLBACK TO SAVEPOINT ${name}; RELEASE SAVEPOINT ${name}`);
        } catch {
          // SQLite may already have rolled back after an I/O error. Keep its cause.
        }
        throw error;
      }
    };
  }

  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }
}
