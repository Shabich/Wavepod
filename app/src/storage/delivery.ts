/** Repositories for messages, outbox and de-duplication. */
import type { OutboxEntry } from '../delivery/schedule';
import type { SqlDatabase, SqlRow } from './types';

export type OutgoingStatus =
  | 'pending'
  | 'sent'
  | 'moduleAck'
  | 'delivered'
  | 'read'
  | 'failed';
export type MessageStatus = OutgoingStatus | 'received';

export interface StoredMessage {
  contactId: string;
  direction: 'in' | 'out';
  messageId: number;
  body: string;
  status: MessageStatus;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Statuses an outgoing message may still leave (delivered/read are final). */
const UPGRADABLE: Record<OutgoingStatus, OutgoingStatus[]> = {
  pending: ['failed'],
  sent: ['pending', 'failed'],
  moduleAck: ['pending', 'sent', 'failed'],
  delivered: ['pending', 'sent', 'moduleAck', 'failed'],
  read: ['pending', 'sent', 'moduleAck', 'delivered', 'failed'],
  failed: ['pending', 'sent', 'moduleAck'],
};

export class MessagesRepository {
  constructor(private readonly db: SqlDatabase) {}

  async insert(m: Omit<StoredMessage, 'updatedAt' | 'error'>) {
    await this.db.execute(
      `INSERT OR IGNORE INTO messages
         (contact_id, direction, message_id, body, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        m.contactId,
        m.direction,
        m.messageId,
        m.body,
        m.status,
        m.createdAt,
        m.createdAt,
      ],
    );
  }

  /**
   * Moves an outgoing message to `status` only from an allowed previous status,
   * so late or out-of-order events never downgrade it (e.g. delivered -> sent).
   * Returns true if the row changed.
   */
  async advance(
    contactId: string,
    messageId: number,
    status: OutgoingStatus,
    at: number,
    error: string | null = null,
  ): Promise<boolean> {
    const from = UPGRADABLE[status];
    const { rowsAffected } = await this.db.execute(
      `UPDATE messages SET status = ?, error = ?, updated_at = ?
       WHERE contact_id = ? AND direction = 'out' AND message_id = ?
         AND status IN (${from.map(() => '?').join(', ')})`,
      [status, error, at, contactId, messageId, ...from],
    );
    return rowsAffected > 0;
  }

  /** Manual resend of a failed message: back to pending regardless of the usual order. */
  async reopen(contactId: string, messageId: number, at: number) {
    await this.db.execute(
      `UPDATE messages SET status = 'pending', error = NULL, updated_at = ?
       WHERE contact_id = ? AND direction = 'out' AND message_id = ?`,
      [at, contactId, messageId],
    );
  }

  async get(contactId: string, direction: 'in' | 'out', messageId: number) {
    const { rows } = await this.db.execute(
      `SELECT * FROM messages WHERE contact_id = ? AND direction = ? AND message_id = ?`,
      [contactId, direction, messageId],
    );
    return rows[0] ? toMessage(rows[0]) : null;
  }

  async listForContact(
    contactId: string,
    limit = 200,
  ): Promise<StoredMessage[]> {
    const { rows } = await this.db.execute(
      `SELECT * FROM messages WHERE contact_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      [contactId, limit],
    );
    return rows.map(toMessage).reverse();
  }

  async remove(contactId: string, messageId: number) {
    await this.db.execute(
      `DELETE FROM messages WHERE contact_id = ? AND direction = 'out' AND message_id = ?`,
      [contactId, messageId],
    );
  }
}

export class OutboxRepository {
  constructor(private readonly db: SqlDatabase) {}

  async add(e: OutboxEntry) {
    await this.db.execute(
      `INSERT INTO outbox (contact_id, message_id, envelope, attempts, burst_attempts,
         last_attempt_at, packet_id, created_at, expires_at, forced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.contactId,
        e.messageId,
        e.envelope,
        e.attempts,
        e.burstAttempts,
        e.lastAttemptAt,
        e.packetId,
        e.createdAt,
        e.expiresAt,
        e.forced ? 1 : 0,
      ],
    );
  }

  async all(): Promise<OutboxEntry[]> {
    const { rows } = await this.db.execute(
      `SELECT * FROM outbox ORDER BY created_at, rowid`,
    );
    return rows.map(toEntry);
  }

  async get(contactId: string, messageId: number) {
    const { rows } = await this.db.execute(
      `SELECT * FROM outbox WHERE contact_id = ? AND message_id = ?`,
      [contactId, messageId],
    );
    return rows[0] ? toEntry(rows[0]) : null;
  }

  async findByPacketId(packetId: number) {
    const { rows } = await this.db.execute(
      `SELECT * FROM outbox WHERE packet_id = ?`,
      [packetId],
    );
    return rows[0] ? toEntry(rows[0]) : null;
  }

  async recordAttempt(
    e: OutboxEntry,
    packetId: number,
    burstAttempts: number,
    at: number,
  ) {
    await this.db.execute(
      `UPDATE outbox SET attempts = attempts + 1, burst_attempts = ?, last_attempt_at = ?,
         packet_id = ?, forced = 0 WHERE contact_id = ? AND message_id = ?`,
      [burstAttempts, at, packetId, e.contactId, e.messageId],
    );
  }

  /** New signal from the contact: entries whose burst is over may start a new one. */
  async resetExhausted(contactId: string, burstSize: number) {
    await this.db.execute(
      `UPDATE outbox SET burst_attempts = 0
       WHERE contact_id = ? AND burst_attempts >= ?`,
      [contactId, burstSize],
    );
  }

  /** Manual resend: new burst now, fresh TTL. */
  async restart(contactId: string, messageId: number, expiresAt: number) {
    await this.db.execute(
      `UPDATE outbox SET burst_attempts = 0, forced = 1, expires_at = ?
       WHERE contact_id = ? AND message_id = ?`,
      [expiresAt, contactId, messageId],
    );
  }

  async remove(contactId: string, messageId: number) {
    await this.db.execute(
      `DELETE FROM outbox WHERE contact_id = ? AND message_id = ?`,
      [contactId, messageId],
    );
  }
}

export class DedupRepository {
  constructor(private readonly db: SqlDatabase) {}

  /** Records the id. Returns false if it was already seen. */
  async firstSeen(contactId: string, messageId: number, at: number) {
    const { rowsAffected } = await this.db.execute(
      `INSERT OR IGNORE INTO dedup (contact_id, message_id, seen_at) VALUES (?, ?, ?)`,
      [contactId, messageId, at],
    );
    return rowsAffected > 0;
  }

  async purgeBefore(at: number) {
    await this.db.execute(`DELETE FROM dedup WHERE seen_at < ?`, [at]);
  }
}

function toMessage(r: SqlRow): StoredMessage {
  return {
    contactId: String(r.contact_id),
    direction: r.direction as 'in' | 'out',
    messageId: Number(r.message_id),
    body: String(r.body),
    status: r.status as MessageStatus,
    error: r.error === null ? null : String(r.error),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function toEntry(r: SqlRow): OutboxEntry {
  return {
    contactId: String(r.contact_id),
    messageId: Number(r.message_id),
    envelope: r.envelope as Uint8Array,
    createdAt: Number(r.created_at),
    expiresAt: Number(r.expires_at),
    attempts: Number(r.attempts),
    burstAttempts: Number(r.burst_attempts),
    lastAttemptAt:
      r.last_attempt_at === null ? null : Number(r.last_attempt_at),
    packetId: r.packet_id === null ? null : Number(r.packet_id),
    forced: Number(r.forced) === 1,
  };
}
