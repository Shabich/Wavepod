/**
 * SqlDatabase over Node's built-in SQLite, for tests. No encryption: SQLCipher itself
 * is checked on device by the storage self-test.
 */
import type {
  DatabaseFactory,
  SqlDatabase,
  SqlRow,
  SqlValue,
} from '../src/storage/types';

type NodeSqlite = {
  DatabaseSync: new (path: string) => {
    prepare(sql: string): {
      all(...params: unknown[]): Record<string, unknown>[];
      run(...params: unknown[]): { changes: number | bigint };
    };
    exec(sql: string): void;
    close(): void;
  };
};

const { DatabaseSync } = require('node:sqlite') as NodeSqlite;

export class NodeSqliteDatabase implements SqlDatabase {
  private db: InstanceType<NodeSqlite['DatabaseSync']>;
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
  }
  async execute(sql: string, params: SqlValue[] = []) {
    const stmt = this.db.prepare(sql);
    if (/^\s*(SELECT|PRAGMA\s+\w+\s*$)/i.test(sql)) {
      const rows = stmt.all(...params).map(r => {
        const out: SqlRow = {};
        for (const [k, v] of Object.entries(r)) {
          out[k] =
            v instanceof Uint8Array ? new Uint8Array(v) : (v as SqlValue);
        }
        return out;
      });
      return { rows, rowsAffected: 0 };
    }
    const r = stmt.run(...params);
    return { rows: [], rowsAffected: Number(r.changes) };
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.db.exec('BEGIN');
    try {
      const v = await fn();
      this.db.exec('COMMIT');
      return v;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  async close() {
    this.db.close();
  }
}

/** In-memory factory that simulates "file exists" and a key check. */
export class MemoryDatabaseFactory implements DatabaseFactory {
  db: NodeSqliteDatabase | null = null;
  key: string | null = null;
  opens = 0;
  async exists() {
    return this.db !== null;
  }
  async open(key: string) {
    this.opens++;
    if (this.db === null) {
      this.db = new NodeSqliteDatabase();
      this.key = key;
    } else if (key !== this.key) {
      throw new Error('file is not a database');
    }
    return this.db;
  }
  async destroy() {
    this.db = null;
    this.key = null;
  }
}
