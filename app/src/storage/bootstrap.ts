/**
 * App start: load or create the identity and open the encrypted database.
 *
 * The database file decides what a "fresh install" is. On iOS, Keychain items
 * survive app deletion, so a missing database with leftover secrets means a
 * reinstall: the old secrets are wiped and a new identity is created.
 */
import { randomBytes } from '@noble/hashes/utils.js';
import {
  identityFromMasterSeed,
  newMasterSeed,
  type WavepodIdentity,
} from '../crypto/identity';
import { toHex } from '../crypto/envelope';
import { migrate } from './migrations';
import type { DatabaseFactory, SecretStore, SqlDatabase } from './types';

export const SECRET_SEED = 'wavepod.identity.seed';
export const SECRET_DB_KEY = 'wavepod.db.key';

export type BootstrapErrorKind =
  /** Database exists but its key or the identity seed is gone (restored backup, Keystore reset). */
  | 'keys-missing'
  /** Database exists but cannot be decrypted with the stored key. */
  | 'db-unreadable';

export class BootstrapError extends Error {
  constructor(readonly kind: BootstrapErrorKind, message: string) {
    super(message);
  }
}

export interface Bootstrapped {
  identity: WavepodIdentity;
  db: SqlDatabase;
  created: boolean;
}

export async function bootstrap(
  secrets: SecretStore,
  dbFactory: DatabaseFactory,
  now: () => number = Date.now,
): Promise<Bootstrapped> {
  if (!(await dbFactory.exists())) return create(secrets, dbFactory, now);

  const seedHex = await secrets.get(SECRET_SEED);
  const dbKey = await secrets.get(SECRET_DB_KEY);
  if (!seedHex || !dbKey) {
    throw new BootstrapError(
      'keys-missing',
      'identity or database key missing',
    );
  }
  let db: SqlDatabase;
  try {
    db = await dbFactory.open(dbKey);
    await db.execute('SELECT count(*) AS n FROM sqlite_master');
  } catch (e) {
    throw new BootstrapError(
      'db-unreadable',
      `cannot open database: ${String(e)}`,
    );
  }
  await migrate(db);
  const identity = identityFromMasterSeed(fromHex(seedHex));
  const { rows } = await db.execute(
    `SELECT value FROM meta WHERE key = 'contact_id'`,
  );
  if (rows[0]?.value !== identity.contactId) {
    await db.close();
    throw new BootstrapError(
      'keys-missing',
      'stored identity does not match the database',
    );
  }
  return { identity, db, created: false };
}

/**
 * Deletes the database and all secrets. Used after a BootstrapError once the user
 * has confirmed: the old messages cannot be recovered without the keys.
 */
export async function resetAll(
  secrets: SecretStore,
  dbFactory: DatabaseFactory,
) {
  await dbFactory.destroy();
  await secrets.remove(SECRET_SEED);
  await secrets.remove(SECRET_DB_KEY);
}

async function create(
  secrets: SecretStore,
  dbFactory: DatabaseFactory,
  now: () => number,
): Promise<Bootstrapped> {
  // Leftovers from a previous install (iOS Keychain) must not be reused.
  await secrets.remove(SECRET_SEED);
  await secrets.remove(SECRET_DB_KEY);

  const seed = newMasterSeed();
  const dbKey = toHex(randomBytes(32));
  await secrets.set(SECRET_SEED, toHex(seed));
  await secrets.set(SECRET_DB_KEY, dbKey);

  const identity = identityFromMasterSeed(seed);
  const db = await dbFactory.open(dbKey);
  await migrate(db);
  await db.execute(
    `INSERT INTO meta (key, value) VALUES ('contact_id', ?), ('created_at', ?)`,
    [identity.contactId, String(now())],
  );
  return { identity, db, created: true };
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex))
    throw new Error('invalid hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
