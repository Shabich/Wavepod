/**
 * Schema migrations, applied in order and tracked with PRAGMA user_version.
 * Never edit a released migration: append a new one.
 */
import type { SqlDatabase } from './types';

export const MIGRATIONS: string[][] = [
  // 1: initial schema
  [
    `CREATE TABLE meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
    `CREATE TABLE contacts (
      id TEXT PRIMARY KEY,
      public_key BLOB NOT NULL UNIQUE,
      sign_key BLOB,
      key_hint INTEGER NOT NULL,
      name TEXT NOT NULL,
      node_num INTEGER,
      verified INTEGER NOT NULL DEFAULT 0,
      last_seen_at INTEGER,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX contacts_key_hint ON contacts(key_hint)`,
    `CREATE INDEX contacts_node_num ON contacts(node_num)`,
    `CREATE TABLE messages (
      contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
      message_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (contact_id, direction, message_id)
    )`,
    `CREATE INDEX messages_by_contact ON messages(contact_id, created_at)`,
    `CREATE TABLE outbox (
      contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      message_id INTEGER NOT NULL,
      envelope BLOB NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      packet_id INTEGER,
      next_attempt_at INTEGER,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (contact_id, message_id)
    )`,
    `CREATE TABLE dedup (
      contact_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      seen_at INTEGER NOT NULL,
      PRIMARY KEY (contact_id, message_id)
    )`,
    `CREATE INDEX dedup_seen_at ON dedup(seen_at)`,
  ],
  // 2: delivery engine (task 05)
  [
    `ALTER TABLE outbox ADD COLUMN burst_attempts INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE outbox ADD COLUMN last_attempt_at INTEGER`,
    `ALTER TABLE outbox ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE outbox ADD COLUMN forced INTEGER NOT NULL DEFAULT 0`,
    `CREATE INDEX outbox_packet ON outbox(packet_id)`,
    `ALTER TABLE contacts ADD COLUMN last_probe_at INTEGER`,
  ],
  // 3: QR contacts (task 04)
  [`ALTER TABLE contacts ADD COLUMN mesh_contact BLOB`],
  // 4: presence (task 06)
  [
    `ALTER TABLE contacts ADD COLUMN beacon_key BLOB`,
    `ALTER TABLE contacts ADD COLUMN hello_sent_at INTEGER`,
  ],
  // 5: profiles (task 09)
  [
    `ALTER TABLE contacts ADD COLUMN avatar_icon INTEGER`,
    `ALTER TABLE contacts ADD COLUMN avatar_color INTEGER`,
    `ALTER TABLE contacts ADD COLUMN bio TEXT`,
    `ALTER TABLE contacts ADD COLUMN remote_name TEXT`,
    `ALTER TABLE contacts ADD COLUMN profile_sent_version INTEGER`,
  ],
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export async function migrate(db: SqlDatabase): Promise<number> {
  await db.execute('PRAGMA foreign_keys = ON');
  const { rows } = await db.execute('PRAGMA user_version');
  const current = Number(rows[0]?.user_version ?? 0);
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `database schema ${current} is newer than this app (${SCHEMA_VERSION})`,
    );
  }
  for (let v = current; v < SCHEMA_VERSION; v++) {
    await db.transaction(async () => {
      for (const sql of MIGRATIONS[v]) await db.execute(sql);
      await db.execute(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return SCHEMA_VERSION;
}
