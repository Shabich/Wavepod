/**
 * On-device check that the database really is encrypted with SQLCipher:
 * a database written with key A must not open with key B.
 */
import { randomBytes } from '@noble/hashes/utils.js';
import { toHex } from '../crypto/envelope';
import { OpSqliteFactory } from './native';

export async function runStorageSelfTest(): Promise<{
  ok: boolean;
  detail: string;
}> {
  const factory = new OpSqliteFactory('wavepod-selftest.db');
  const keyA = toHex(randomBytes(32));
  const keyB = toHex(randomBytes(32));
  try {
    if (await factory.exists()) await factory.destroy();
    const db = await factory.open(keyA);
    await db.execute('CREATE TABLE t (v TEXT)');
    await db.execute('INSERT INTO t (v) VALUES (?)', ['secret']);
    await db.close();

    let wrongKeyOpened = false;
    try {
      const other = await factory.open(keyB);
      await other.execute('SELECT v FROM t');
      wrongKeyOpened = true;
      await other.close();
    } catch {
      // expected: SQLCipher refuses the wrong key
    }
    if (wrongKeyOpened) {
      return {
        ok: false,
        detail: 'base lisible avec une mauvaise clé (SQLCipher inactif ?)',
      };
    }

    const again = await factory.open(keyA);
    const { rows } = await again.execute('SELECT v FROM t');
    await again.close();
    if (rows[0]?.v !== 'secret')
      return { ok: false, detail: 'relecture incorrecte' };
    return { ok: true, detail: 'base chiffrée OK' };
  } catch (e) {
    return { ok: false, detail: `stockage en échec : ${String(e)}` };
  } finally {
    await factory.destroy().catch(() => undefined);
  }
}
