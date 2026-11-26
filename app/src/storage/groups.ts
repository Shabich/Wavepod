/** Groups, members, group messages and per-member receipts. */
import type { SqlDatabase, SqlRow } from './types';

export interface Group {
  id: string;
  name: string;
  key: Uint8Array;
  hint: number;
  createdBy: string;
  createdAt: number;
}

export interface GroupMessage {
  groupId: string;
  messageId: number;
  /** 'me' or the sender's contact id. */
  sender: string;
  body: string;
  createdAt: number;
}

export interface Receipt {
  groupId: string;
  messageId: number;
  memberId: string;
  ackedAt: number | null;
  copyId: number | null;
}

export const ME = 'me';

export class GroupsRepository {
  constructor(private readonly db: SqlDatabase) {}

  async create(g: Group, members: string[]) {
    await this.db.execute(
      `INSERT OR IGNORE INTO groups (id, name, key, hint, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [g.id, g.name, g.key, g.hint, g.createdBy, g.createdAt],
    );
    for (const m of members) await this.addMember(g.id, m);
  }

  async get(id: string): Promise<Group | null> {
    const { rows } = await this.db.execute(
      'SELECT * FROM groups WHERE id = ?',
      [id],
    );
    return rows[0] ? toGroup(rows[0]) : null;
  }

  async list(): Promise<Group[]> {
    const { rows } = await this.db.execute(
      'SELECT * FROM groups ORDER BY name COLLATE NOCASE',
    );
    return rows.map(toGroup);
  }

  async byHint(hint: number): Promise<Group[]> {
    const { rows } = await this.db.execute(
      'SELECT * FROM groups WHERE hint = ?',
      [hint],
    );
    return rows.map(toGroup);
  }

  async addMember(groupId: string, memberId: string) {
    await this.db.execute(
      'INSERT OR IGNORE INTO group_members (group_id, member_id) VALUES (?, ?)',
      [groupId, memberId],
    );
  }

  async members(groupId: string): Promise<string[]> {
    const { rows } = await this.db.execute(
      'SELECT member_id FROM group_members WHERE group_id = ? ORDER BY rowid',
      [groupId],
    );
    return rows.map(r => String(r.member_id));
  }

  /** Stores a message. Returns false if it was already known (duplicate). */
  async addMessage(m: GroupMessage): Promise<boolean> {
    const { rowsAffected } = await this.db.execute(
      `INSERT OR IGNORE INTO group_messages (group_id, message_id, sender, body, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [m.groupId, m.messageId, m.sender, m.body, m.createdAt],
    );
    return rowsAffected > 0;
  }

  async messages(groupId: string, limit = 200): Promise<GroupMessage[]> {
    const { rows } = await this.db.execute(
      `SELECT * FROM group_messages WHERE group_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      [groupId, limit],
    );
    return rows
      .map(r => ({
        groupId: String(r.group_id),
        messageId: Number(r.message_id),
        sender: String(r.sender),
        body: String(r.body),
        createdAt: Number(r.created_at),
      }))
      .reverse();
  }

  async lastMessageAt(groupId: string): Promise<number | null> {
    const { rows } = await this.db.execute(
      'SELECT MAX(created_at) AS t FROM group_messages WHERE group_id = ?',
      [groupId],
    );
    return rows[0]?.t === null || rows[0]?.t === undefined
      ? null
      : Number(rows[0].t);
  }

  async addReceipts(groupId: string, messageId: number, memberIds: string[]) {
    for (const m of memberIds) {
      await this.db.execute(
        `INSERT OR IGNORE INTO group_receipts (group_id, message_id, member_id)
         VALUES (?, ?, ?)`,
        [groupId, messageId, m],
      );
    }
  }

  async receipts(groupId: string, messageId: number): Promise<Receipt[]> {
    const { rows } = await this.db.execute(
      'SELECT * FROM group_receipts WHERE group_id = ? AND message_id = ?',
      [groupId, messageId],
    );
    return rows.map(toReceipt);
  }

  /** Receipts still waiting for an ack and with no DM copy queued yet. */
  async pendingWithoutCopy(): Promise<(Receipt & { createdAt: number })[]> {
    const { rows } = await this.db.execute(
      `SELECT r.*, m.created_at AS created_at FROM group_receipts r
       JOIN group_messages m ON m.group_id = r.group_id AND m.message_id = r.message_id
       WHERE r.acked_at IS NULL AND r.copy_id IS NULL`,
    );
    return rows.map(r => ({
      ...toReceipt(r),
      createdAt: Number(r.created_at),
    }));
  }

  /** Marks an ack. Returns the receipt as it was (to cancel a queued copy). */
  async ack(groupId: string, messageId: number, memberId: string, at: number) {
    const { rows } = await this.db.execute(
      `SELECT * FROM group_receipts WHERE group_id = ? AND message_id = ? AND member_id = ?`,
      [groupId, messageId, memberId],
    );
    if (!rows[0]) return null;
    await this.db.execute(
      `UPDATE group_receipts SET acked_at = COALESCE(acked_at, ?)
       WHERE group_id = ? AND message_id = ? AND member_id = ?`,
      [at, groupId, messageId, memberId],
    );
    return toReceipt(rows[0]);
  }

  async setCopy(
    groupId: string,
    messageId: number,
    memberId: string,
    copyId: number,
  ) {
    await this.db.execute(
      `UPDATE group_receipts SET copy_id = ?
       WHERE group_id = ? AND message_id = ? AND member_id = ?`,
      [copyId, groupId, messageId, memberId],
    );
  }

  async receiptByCopy(
    memberId: string,
    copyId: number,
  ): Promise<Receipt | null> {
    const { rows } = await this.db.execute(
      'SELECT * FROM group_receipts WHERE member_id = ? AND copy_id = ?',
      [memberId, copyId],
    );
    return rows[0] ? toReceipt(rows[0]) : null;
  }
}

function toGroup(r: SqlRow): Group {
  return {
    id: String(r.id),
    name: String(r.name),
    key: r.key as Uint8Array,
    hint: Number(r.hint),
    createdBy: String(r.created_by),
    createdAt: Number(r.created_at),
  };
}

function toReceipt(r: SqlRow): Receipt {
  return {
    groupId: String(r.group_id),
    messageId: Number(r.message_id),
    memberId: String(r.member_id),
    ackedAt:
      r.acked_at === null || r.acked_at === undefined
        ? null
        : Number(r.acked_at),
    copyId:
      r.copy_id === null || r.copy_id === undefined ? null : Number(r.copy_id),
  };
}
