/** Small key/value settings stored in the encrypted database. */
import type { SqlDatabase } from './types';

export class MetaRepository {
  constructor(private readonly db: SqlDatabase) {}

  async get(key: string): Promise<string | null> {
    const { rows } = await this.db.execute(
      'SELECT value FROM meta WHERE key = ?',
      [key],
    );
    return rows[0] ? String(rows[0].value) : null;
  }

  async set(key: string, value: string) {
    await this.db.execute(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }
}
