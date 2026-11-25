/**
 * Native implementations: Keychain/Keystore secrets and op-sqlite with SQLCipher.
 * Modules are required lazily so importing this file has no native side effect (Jest).
 */
import type { DB, Scalar } from '@op-engineering/op-sqlite';
import type {
  DatabaseFactory,
  SecretStore,
  SqlDatabase,
  SqlRow,
  SqlValue,
} from './types';

export const DB_NAME = 'wavepod.db';

export class KeychainSecretStore implements SecretStore {
  private get keychain() {
    return require('react-native-keychain') as typeof import('react-native-keychain');
  }

  async get(name: string) {
    const r = await this.keychain.getGenericPassword({ service: name });
    return r ? r.password : null;
  }

  async set(name: string, value: string) {
    const k = this.keychain;
    const ok = await k.setGenericPassword('wavepod', value, {
      service: name,
      // Readable in background after the first unlock, never synced or restored to another device.
      accessible: k.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    if (!ok) throw new Error(`keychain write failed for ${name}`);
  }

  async remove(name: string) {
    await this.keychain.resetGenericPassword({ service: name });
  }
}

/**
 * Workaround: op-sqlite 19.0.6 aborts the process (std::terminate in ~WorkerThread)
 * when Hermes garbage-collects a closed or deleted DB host object. Observed on the
 * iOS simulator 2026-11-25. Every handle is kept alive for the app's lifetime so its
 * finalizer never runs; Wavepod opens only a few. Remove once fixed upstream.
 */
const retainedHandles: DB[] = [];

export class OpSqliteFactory implements DatabaseFactory {
  constructor(private readonly name: string = DB_NAME) {}

  private get opsqlite() {
    const lib =
      require('@op-engineering/op-sqlite') as typeof import('@op-engineering/op-sqlite');
    return {
      open: (options: Parameters<typeof lib.open>[0]) => {
        const db = lib.open(options);
        retainedHandles.push(db);
        return db;
      },
    };
  }

  async exists(): Promise<boolean> {
    try {
      const db = this.opsqlite.open({ name: this.name, failOnCreate: true });
      db.close();
      return true;
    } catch {
      return false;
    }
  }

  async open(key: string): Promise<SqlDatabase> {
    const db = this.opsqlite.open({ name: this.name, encryptionKey: key });
    const wrapped = new OpSqliteDatabase(db);
    // SQLCipher only fails on first read with a wrong key: force it now.
    try {
      await wrapped.execute('SELECT count(*) AS n FROM sqlite_master');
    } catch (e) {
      db.close();
      throw e;
    }
    return wrapped;
  }

  async destroy(): Promise<void> {
    const db = this.opsqlite.open({ name: this.name });
    db.delete();
  }
}

class OpSqliteDatabase implements SqlDatabase {
  private txQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly db: DB) {}

  async execute(sql: string, params: SqlValue[] = []) {
    const result = await this.db.execute(sql, params as Scalar[]);
    return {
      rows: (result.rows ?? []).map(normalizeRow),
      rowsAffected: result.rowsAffected ?? 0,
    };
  }

  /**
   * Transactions are serialized with a JS queue. Plain execute() calls from other flows
   * are not blocked; the app keeps writes inside one flow per table for now.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      await this.db.execute('BEGIN IMMEDIATE');
      try {
        const value = await fn();
        await this.db.execute('COMMIT');
        return value;
      } catch (e) {
        await this.db.execute('ROLLBACK');
        throw e;
      }
    };
    const next = this.txQueue.then(run, run);
    this.txQueue = next.catch(() => undefined);
    return next;
  }

  async close() {
    this.db.close();
  }
}

function normalizeRow(row: Record<string, Scalar>): SqlRow {
  const out: SqlRow = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof ArrayBuffer) out[k] = new Uint8Array(v);
    else if (ArrayBuffer.isView(v))
      out[k] = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    else if (typeof v === 'boolean') out[k] = v ? 1 : 0;
    else out[k] = v as SqlValue;
  }
  return out;
}
