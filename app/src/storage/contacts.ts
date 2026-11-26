/** Contacts repository. A contact's address is derived from its key, never from its node. */
import { contactId, keyHint } from '../crypto/envelope';
import type { SqlDatabase, SqlRow } from './types';

export interface Contact {
  id: string;
  publicKey: Uint8Array;
  signKey: Uint8Array | null;
  keyHint: number;
  name: string;
  /** Last known Meshtastic node number: a routing hint, updated when the contact changes module. */
  nodeNum: number | null;
  verified: boolean;
  lastSeenAt: number | null;
  lastProbeAt: number | null;
  /** Meshtastic SharedContact of the contact's module, re-injected into our module. */
  meshContact: Uint8Array | null;
  /** The contact's beacon key (from its Hello), to recognise its beacons. */
  beaconKey: Uint8Array | null;
  /** When we queued our own Hello for this contact (null = not yet). */
  helloSentAt: number | null;
  createdAt: number;
}

export interface NewContact {
  publicKey: Uint8Array;
  signKey?: Uint8Array;
  name: string;
  nodeNum?: number;
  meshContact?: Uint8Array;
}

export class ContactsRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  /** Adds a contact, or updates name/node of an existing one with the same key. */
  async upsert(c: NewContact): Promise<Contact> {
    if (c.publicKey.length !== 32)
      throw new Error('public key must be 32 bytes');
    const id = contactId(c.publicKey);
    await this.db.execute(
      `INSERT INTO contacts (id, public_key, sign_key, key_hint, name, node_num, mesh_contact, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         sign_key = COALESCE(excluded.sign_key, contacts.sign_key),
         node_num = COALESCE(excluded.node_num, contacts.node_num),
         mesh_contact = COALESCE(excluded.mesh_contact, contacts.mesh_contact)`,
      [
        id,
        c.publicKey,
        c.signKey ?? null,
        keyHint(c.publicKey),
        c.name,
        c.nodeNum ?? null,
        c.meshContact ?? null,
        this.now(),
      ],
    );
    return (await this.get(id))!;
  }

  async get(id: string): Promise<Contact | null> {
    const { rows } = await this.db.execute(
      'SELECT * FROM contacts WHERE id = ?',
      [id],
    );
    return rows[0] ? toContact(rows[0]) : null;
  }

  /** Candidates for an incoming envelope (several contacts may share a 2-byte hint). */
  async findByKeyHint(hint: number): Promise<Contact[]> {
    const { rows } = await this.db.execute(
      'SELECT * FROM contacts WHERE key_hint = ?',
      [hint],
    );
    return rows.map(toContact);
  }

  async list(): Promise<Contact[]> {
    const { rows } = await this.db.execute(
      'SELECT * FROM contacts ORDER BY name COLLATE NOCASE',
    );
    return rows.map(toContact);
  }

  /** Any authenticated signal from the contact: refresh "seen" and the routing hint. */
  async markSeen(id: string, nodeNum: number, at: number = this.now()) {
    await this.db.execute(
      'UPDATE contacts SET last_seen_at = MAX(COALESCE(last_seen_at, 0), ?), node_num = ? WHERE id = ?',
      [at, nodeNum, id],
    );
  }

  async setLastProbe(id: string, at: number) {
    await this.db.execute(
      'UPDATE contacts SET last_probe_at = ? WHERE id = ?',
      [at, id],
    );
  }

  async setBeaconKey(id: string, key: Uint8Array) {
    await this.db.execute('UPDATE contacts SET beacon_key = ? WHERE id = ?', [
      key,
      id,
    ]);
  }

  async markHelloSent(id: string, at: number) {
    await this.db.execute(
      'UPDATE contacts SET hello_sent_at = ? WHERE id = ?',
      [at, id],
    );
  }

  async findByNodeNum(nodeNum: number): Promise<Contact[]> {
    const { rows } = await this.db.execute(
      'SELECT * FROM contacts WHERE node_num = ?',
      [nodeNum],
    );
    return rows.map(toContact);
  }

  async setVerified(id: string, verified: boolean) {
    await this.db.execute('UPDATE contacts SET verified = ? WHERE id = ?', [
      verified ? 1 : 0,
      id,
    ]);
  }

  async remove(id: string) {
    await this.db.execute('DELETE FROM contacts WHERE id = ?', [id]);
  }
}

function toContact(r: SqlRow): Contact {
  return {
    id: String(r.id),
    publicKey: r.public_key as Uint8Array,
    signKey: (r.sign_key as Uint8Array | null) ?? null,
    keyHint: Number(r.key_hint),
    name: String(r.name),
    nodeNum: r.node_num === null ? null : Number(r.node_num),
    verified: Number(r.verified) === 1,
    lastSeenAt: r.last_seen_at === null ? null : Number(r.last_seen_at),
    lastProbeAt:
      r.last_probe_at === null || r.last_probe_at === undefined
        ? null
        : Number(r.last_probe_at),
    meshContact: (r.mesh_contact as Uint8Array | null | undefined) ?? null,
    beaconKey: (r.beacon_key as Uint8Array | null | undefined) ?? null,
    helloSentAt:
      r.hello_sent_at === null || r.hello_sent_at === undefined
        ? null
        : Number(r.hello_sent_at),
    createdAt: Number(r.created_at),
  };
}
