import {
  BootstrapError,
  SECRET_DB_KEY,
  SECRET_SEED,
  bootstrap,
  fromHex,
  resetAll,
} from '../src/storage/bootstrap';
import { ContactsRepository } from '../src/storage/contacts';
import { SCHEMA_VERSION, migrate } from '../src/storage/migrations';
import { MemorySecretStore } from '../src/storage/types';
import {
  identityFromMasterSeed,
  newMasterSeed,
  safetyNumber,
} from '../src/crypto/identity';
import { generateIdentity, keyHint } from '../src/crypto/envelope';
import { MemoryDatabaseFactory, NodeSqliteDatabase } from './nodeSqlite';
import { bytesEqual } from './helpers';

describe('identity', () => {
  it('derives stable, distinct key pairs from one seed', () => {
    const seed = newMasterSeed();
    const a = identityFromMasterSeed(seed);
    const b = identityFromMasterSeed(seed);
    expect(bytesEqual(a.box.publicKey, b.box.publicKey)).toBe(true);
    expect(bytesEqual(a.sign.publicKey, b.sign.publicKey)).toBe(true);
    expect(bytesEqual(a.box.secretKey, a.sign.secretKey)).toBe(false);
    expect(a.contactId).toMatch(/^[0-9a-f]{16}$/);
    expect(identityFromMasterSeed(newMasterSeed()).contactId).not.toBe(
      a.contactId,
    );
  });

  it('gives both sides the same safety number', () => {
    const a = generateIdentity().publicKey;
    const b = generateIdentity().publicKey;
    expect(safetyNumber(a, b)).toBe(safetyNumber(b, a));
    expect(safetyNumber(a, b)).toMatch(/^\d{4} \d{4} \d{4}$/);
    expect(safetyNumber(a, generateIdentity().publicKey)).not.toBe(
      safetyNumber(a, b),
    );
  });
});

describe('migrations', () => {
  it('creates the schema once', async () => {
    const db = new NodeSqliteDatabase();
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    expect(await migrate(db)).toBe(SCHEMA_VERSION);
    const { rows } = await db.execute(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    );
    expect(rows.map(r => r.name)).toEqual([
      'contacts',
      'dedup',
      'group_members',
      'group_messages',
      'group_receipts',
      'groups',
      'messages',
      'meta',
      'outbox',
    ]);
  });

  it('refuses a database from a newer app', async () => {
    const db = new NodeSqliteDatabase();
    await db.execute(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    await expect(migrate(db)).rejects.toThrow('newer');
  });
});

describe('bootstrap', () => {
  it('creates an identity on first launch and reloads it after', async () => {
    const secrets = new MemorySecretStore();
    const files = new MemoryDatabaseFactory();
    const first = await bootstrap(secrets, files);
    expect(first.created).toBe(true);
    expect(secrets.values.get(SECRET_SEED)).toMatch(/^[0-9a-f]{64}$/);
    expect(secrets.values.get(SECRET_DB_KEY)).toMatch(/^[0-9a-f]{64}$/);

    const second = await bootstrap(secrets, files);
    expect(second.created).toBe(false);
    expect(second.identity.contactId).toBe(first.identity.contactId);
  });

  it('creates a new identity after reinstall even if old keychain items remain', async () => {
    const secrets = new MemorySecretStore();
    const first = await bootstrap(secrets, new MemoryDatabaseFactory());
    const oldSeed = secrets.values.get(SECRET_SEED);
    // App deleted: database gone, iOS Keychain kept.
    const after = await bootstrap(secrets, new MemoryDatabaseFactory());
    expect(after.created).toBe(true);
    expect(secrets.values.get(SECRET_SEED)).not.toBe(oldSeed);
    expect(after.identity.contactId).not.toBe(first.identity.contactId);
  });

  it('reports missing keys when the database survived without them', async () => {
    const secrets = new MemorySecretStore();
    const files = new MemoryDatabaseFactory();
    await bootstrap(secrets, files);
    secrets.values.delete(SECRET_DB_KEY);
    await expect(bootstrap(secrets, files)).rejects.toMatchObject({
      kind: 'keys-missing',
    });
  });

  it('reports an unreadable database with a wrong key', async () => {
    const secrets = new MemorySecretStore();
    const files = new MemoryDatabaseFactory();
    await bootstrap(secrets, files);
    secrets.values.set(SECRET_DB_KEY, 'ff'.repeat(32));
    const err = await bootstrap(secrets, files).catch(e => e);
    expect(err).toBeInstanceOf(BootstrapError);
    expect(err.kind).toBe('db-unreadable');
  });

  it('detects a seed that does not belong to the database', async () => {
    const secrets = new MemorySecretStore();
    const files = new MemoryDatabaseFactory();
    await bootstrap(secrets, files);
    secrets.values.set(SECRET_SEED, 'ab'.repeat(32));
    await expect(bootstrap(secrets, files)).rejects.toMatchObject({
      kind: 'keys-missing',
    });
  });

  it('starts over after resetAll', async () => {
    const secrets = new MemorySecretStore();
    const files = new MemoryDatabaseFactory();
    const first = await bootstrap(secrets, files);
    await resetAll(secrets, files);
    expect(secrets.values.size).toBe(0);
    const again = await bootstrap(secrets, files);
    expect(again.created).toBe(true);
    expect(again.identity.contactId).not.toBe(first.identity.contactId);
  });

  it('parses hex strictly', () => {
    expect(Array.from(fromHex('00ff10'))).toEqual([0, 255, 16]);
    expect(() => fromHex('0g')).toThrow();
    expect(() => fromHex('abc')).toThrow();
  });
});

describe('contacts', () => {
  async function repo() {
    const db = new NodeSqliteDatabase();
    await migrate(db);
    let t = 1000;
    return new ContactsRepository(db, () => t++);
  }

  it('stores a contact under its key-derived id', async () => {
    const r = await repo();
    const pk = generateIdentity().publicKey;
    const c = await r.upsert({ publicKey: pk, name: 'Léa', nodeNum: 0xcafe });
    expect(c.id).toMatch(/^[0-9a-f]{16}$/);
    expect(bytesEqual(c.publicKey, pk)).toBe(true);
    expect(c.keyHint).toBe(keyHint(pk));
    expect(c).toMatchObject({ name: 'Léa', nodeNum: 0xcafe, verified: false });
    expect((await r.findByKeyHint(c.keyHint)).map(x => x.id)).toEqual([c.id]);
  });

  it('updates name and keeps the node when re-added without one', async () => {
    const r = await repo();
    const pk = generateIdentity().publicKey;
    await r.upsert({ publicKey: pk, name: 'Léa', nodeNum: 1 });
    const c = await r.upsert({ publicKey: pk, name: 'Léa B.' });
    expect(c).toMatchObject({ name: 'Léa B.', nodeNum: 1 });
    expect(await r.list()).toHaveLength(1);
  });

  it('tracks last seen and a new module', async () => {
    const r = await repo();
    const c = await r.upsert({
      publicKey: generateIdentity().publicKey,
      name: 'Tom',
    });
    await r.markSeen(c.id, 0xbeef, 5000);
    await r.markSeen(c.id, 0xbeef, 4000); // older signal does not go back in time
    expect(await r.get(c.id)).toMatchObject({
      nodeNum: 0xbeef,
      lastSeenAt: 5000,
    });
  });

  it('rejects malformed keys', async () => {
    const r = await repo();
    await expect(
      r.upsert({ publicKey: new Uint8Array(31), name: 'x' }),
    ).rejects.toThrow();
  });
});
