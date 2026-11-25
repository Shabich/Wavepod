/** Storage boundaries, so the logic can be tested in Jest without native modules. */

export interface SecretStore {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export type SqlValue = string | number | null | Uint8Array;
export type SqlRow = Record<string, SqlValue>;

export interface SqlDatabase {
  execute(
    sql: string,
    params?: SqlValue[],
  ): Promise<{ rows: SqlRow[]; rowsAffected: number }>;
  /** Runs fn in a transaction; rolls back if it throws. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface DatabaseFactory {
  /** True if the database file already exists (decides fresh install vs. existing data). */
  exists(): Promise<boolean>;
  /** Opens (or creates) the encrypted database. Must throw if the key is wrong. */
  open(key: string): Promise<SqlDatabase>;
  /** Deletes the database file. */
  destroy(): Promise<void>;
}

export class MemorySecretStore implements SecretStore {
  readonly values = new Map<string, string>();
  async get(name: string) {
    return this.values.get(name) ?? null;
  }
  async set(name: string, value: string) {
    this.values.set(name, value);
  }
  async remove(name: string) {
    this.values.delete(name);
  }
}
