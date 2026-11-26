/**
 * Group messaging: one encrypted broadcast per message, a small ack from each
 * member to the sender's node, and a DM copy (reliable outbox) for members who did
 * not ack within the fallback delay. See tasks/10-groupes.md.
 */
import { randomBytes } from '@noble/hashes/utils.js';
import type { DeliveryEngine, Scheduler } from '../delivery/engine';
import { open, sealWithHint, toHex } from '../crypto/envelope';
import type { WavepodIdentity } from '../crypto/identity';
import { MessageType, decodeHeader } from '../protocol/codec';
import type {
  RadioInterface,
  RadioPacket,
  Unsubscribe,
} from '../radio/RadioInterface';
import { BROADCAST_ADDR } from '../radio/meshtastic/constants';
import type { ContactsRepository } from '../storage/contacts';
import { ME, type Group, type GroupsRepository } from '../storage/groups';
import type { Avatar } from '../profile/avatar';
import { ProfileService } from '../profile/service';
import {
  GROUP_KEY_BYTES,
  MAX_GROUP_MEMBERS,
  ROSTER_PER_MESSAGE,
  decodeGroupAck,
  decodeGroupCopy,
  decodeGroupText,
  decodeInvite,
  decodeRoster,
  encodeGroupAck,
  encodeGroupCopy,
  encodeGroupText,
  encodeInvite,
  encodeRoster,
  groupHint,
  type RosterMember,
} from './codec';

export const GROUP_FALLBACK_MS = 2 * 60_000;

export interface GroupDeps {
  me: WavepodIdentity;
  radio: RadioInterface;
  engine: DeliveryEngine;
  contacts: ContactsRepository;
  groups: GroupsRepository;
  /** Our current name and avatar, for the roster. */
  myProfile: () => Promise<{ name: string; avatar: Avatar }>;
  scheduler: Scheduler;
  fallbackMs?: number;
  log?: (line: string) => void;
}

export class GroupError extends Error {}

export class GroupService {
  private subscriptions: Unsubscribe[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  /** Rosters received before their invite (DM order is not guaranteed). */
  private pendingRosters = new Map<string, RosterMember[][]>();
  private cancelTimer: (() => void) | null = null;

  constructor(private readonly d: GroupDeps) {}

  async start() {
    this.subscriptions = [
      this.d.radio.onReceive(p => this.serial(() => this.onPacket(p))),
      this.d.engine.onEvent(e => {
        if (e.kind === 'control') {
          this.serial(() => this.onControl(e.contactId, e.type, e.body));
        } else if (e.kind === 'controlDelivered') {
          this.serial(() => this.onCopyDelivered(e.contactId, e.messageId));
        }
      }),
    ];
    await this.serial(() => this.scheduleCopies());
  }

  stop() {
    this.subscriptions.forEach(u => u());
    this.subscriptions = [];
    this.cancelTimer?.();
  }

  onChange(l: () => void): Unsubscribe {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  idle() {
    return this.queue.then(() => undefined);
  }

  /** Creates a group with some of our contacts and invites them. */
  createGroup(name: string, memberIds: string[]): Promise<Group> {
    return this.serial(async () => {
      const unique = [...new Set(memberIds)];
      if (unique.length === 0) throw new GroupError('no members');
      if (unique.length + 1 > MAX_GROUP_MEMBERS)
        throw new GroupError('too many members');
      const members = [];
      for (const id of unique) {
        const c = await this.d.contacts.get(id);
        if (!c) throw new GroupError(`unknown contact ${id}`);
        members.push(c);
      }
      const id = toHex(randomBytes(8));
      const group: Group = {
        id,
        name: name.trim(),
        key: randomBytes(GROUP_KEY_BYTES),
        hint: groupHint(id),
        createdBy: ME,
        createdAt: this.d.scheduler.now(),
      };
      const invite = encodeInvite({
        groupId: id,
        key: group.key,
        name: group.name,
      });
      await this.d.groups.create(group, unique);

      const me = await this.d.myProfile();
      const roster: RosterMember[] = [
        {
          publicKey: this.d.me.box.publicKey,
          nodeNum: this.d.radio.localNode ?? 0,
          avatar: me.avatar,
          name: me.name || 'Wavepod',
        },
        ...members.map(c => ({
          publicKey: c.publicKey,
          nodeNum: c.nodeNum ?? 0,
          avatar: ProfileService.avatarOf(c),
          name: c.remoteName ?? c.name,
        })),
      ];
      for (const c of members) {
        await this.d.engine.sendControl(c.id, MessageType.GroupInvite, invite);
        const others = roster.filter(
          m => toHex(m.publicKey) !== toHex(c.publicKey),
        );
        for (let i = 0; i < others.length; i += ROSTER_PER_MESSAGE) {
          await this.d.engine.sendControl(
            c.id,
            MessageType.GroupRoster,
            encodeRoster(id, others.slice(i, i + ROSTER_PER_MESSAGE)),
          );
        }
      }
      this.changed();
      return group;
    });
  }

  /** Sends a message to the group: one broadcast now, DM copies later if needed. */
  send(groupId: string, text: string): Promise<number> {
    return this.serial(async () => {
      const group = await this.requireGroup(groupId);
      const body = encodeGroupText(this.d.me.contactId, text); // validates length
      const now = this.d.scheduler.now();
      const messageId = randomU32();
      await this.d.groups.addMessage({
        groupId,
        messageId,
        sender: ME,
        body: text,
        createdAt: now,
      });
      await this.d.groups.addReceipts(
        groupId,
        messageId,
        await this.d.groups.members(groupId),
      );
      if (this.d.radio.connectionState === 'ready') {
        const envelope = sealWithHint(
          MessageType.GroupMessage,
          body,
          group.hint,
          group.key,
          messageId,
        );
        try {
          await this.d.radio.send(envelope, BROADCAST_ADDR, { wantAck: false });
        } catch (e) {
          this.log(`group broadcast failed: ${String(e)}`);
        }
      }
      this.changed();
      await this.scheduleCopies();
      return messageId;
    });
  }

  /** "livré à n/m" for one of our messages. */
  async deliveryOf(groupId: string, messageId: number) {
    const r = await this.d.groups.receipts(groupId, messageId);
    return {
      delivered: r.filter(x => x.ackedAt !== null).length,
      total: r.length,
    };
  }

  // ---------------------------------------------------------------- receive

  private async onPacket(p: RadioPacket) {
    const type = p.payload[0] & 0x0f;
    if (type !== MessageType.GroupMessage && type !== MessageType.GroupAck)
      return;
    let hint: number;
    try {
      hint = decodeHeader(p.payload).keyHint;
    } catch {
      return;
    }
    for (const group of await this.d.groups.byHint(hint)) {
      let opened;
      try {
        opened = open(p.payload, group.key);
      } catch {
        continue; // another group sharing this hint
      }
      if (opened.type === MessageType.GroupMessage) {
        await this.onGroupText(
          group,
          opened.messageId,
          opened.plaintext,
          p.from,
        );
      } else if (opened.type === MessageType.GroupAck) {
        await this.onGroupAck(group, opened.plaintext);
      }
      return;
    }
  }

  private async onGroupText(
    group: Group,
    messageId: number,
    plaintext: Uint8Array,
    from: number,
  ) {
    const { senderId, text } = decodeGroupText(plaintext);
    if (senderId === this.d.me.contactId) return;
    const now = this.d.scheduler.now();
    const fresh = await this.d.groups.addMessage({
      groupId: group.id,
      messageId,
      sender: senderId,
      body: text,
      createdAt: now,
    });
    // Ack every copy (the previous ack may have been lost), to the sender's node only.
    const ack = sealWithHint(
      MessageType.GroupAck,
      encodeGroupAck(this.d.me.contactId, [messageId]),
      group.hint,
      group.key,
    );
    if (this.d.radio.connectionState === 'ready') {
      await this.d.radio
        .send(ack, from, { wantAck: false })
        .catch(() => undefined);
    }
    if (await this.d.contacts.get(senderId)) {
      await this.d.engine.signal(senderId, from, now);
    }
    if (fresh) this.changed();
  }

  private async onGroupAck(group: Group, plaintext: Uint8Array) {
    const { ackerId, messageIds } = decodeGroupAck(plaintext);
    const now = this.d.scheduler.now();
    for (const id of messageIds) {
      const before = await this.d.groups.ack(group.id, id, ackerId, now);
      if (before && before.ackedAt === null && before.copyId !== null) {
        await this.d.engine.cancel(ackerId, before.copyId); // copy no longer needed
      }
    }
    this.changed();
  }

  private async onControl(from: string, type: MessageType, body: Uint8Array) {
    if (type === MessageType.GroupInvite) {
      const inv = decodeInvite(body);
      if (inv.key.length !== GROUP_KEY_BYTES) return;
      await this.d.groups.create(
        {
          id: inv.groupId,
          name: inv.name,
          key: inv.key,
          hint: groupHint(inv.groupId),
          createdBy: from,
          createdAt: this.d.scheduler.now(),
        },
        [from],
      );
      for (const members of this.pendingRosters.get(inv.groupId) ?? []) {
        await this.applyRoster(inv.groupId, members);
      }
      this.pendingRosters.delete(inv.groupId);
      this.changed();
    } else if (type === MessageType.GroupRoster) {
      const { groupId, members } = decodeRoster(body);
      if (await this.d.groups.get(groupId)) {
        await this.applyRoster(groupId, members);
        this.changed();
      } else {
        const list = this.pendingRosters.get(groupId) ?? [];
        list.push(members);
        this.pendingRosters.set(groupId, list);
      }
    } else if (type === MessageType.GroupCopy) {
      const c = decodeGroupCopy(body);
      if (!(await this.d.groups.get(c.groupId))) return;
      const fresh = await this.d.groups.addMessage({
        groupId: c.groupId,
        messageId: c.messageId,
        sender: c.senderId,
        body: c.text,
        createdAt: this.d.scheduler.now(),
      });
      if (fresh) this.changed();
    }
  }

  private async applyRoster(groupId: string, members: RosterMember[]) {
    const mine = toHex(this.d.me.box.publicKey);
    for (const m of members) {
      if (toHex(m.publicKey) === mine) continue;
      const c = await this.d.contacts.upsertMember(m);
      await this.d.groups.addMember(groupId, c.id);
    }
  }

  // ---------------------------------------------------------------- fallback copies

  private async onCopyDelivered(contactId: string, copyId: number) {
    const r = await this.d.groups.receiptByCopy(contactId, copyId);
    if (!r) return;
    await this.d.groups.ack(
      r.groupId,
      r.messageId,
      contactId,
      this.d.scheduler.now(),
    );
    this.changed();
  }

  /** Queues DM copies for members who did not ack in time; re-arms the timer. */
  private async scheduleCopies() {
    const now = this.d.scheduler.now();
    const delay = this.d.fallbackMs ?? GROUP_FALLBACK_MS;
    let next: number | null = null;
    for (const r of await this.d.groups.pendingWithoutCopy()) {
      const due = r.createdAt + delay;
      if (due > now) {
        next = next === null ? due : Math.min(next, due);
        continue;
      }
      const msg = (await this.d.groups.messages(r.groupId)).find(
        m => m.messageId === r.messageId,
      );
      if (!msg || !(await this.d.contacts.get(r.memberId))) continue;
      const copyId = await this.d.engine.sendControl(
        r.memberId,
        MessageType.GroupCopy,
        encodeGroupCopy({
          groupId: r.groupId,
          messageId: r.messageId,
          senderId: this.d.me.contactId,
          text: msg.body,
        }),
      );
      await this.d.groups.setCopy(r.groupId, r.messageId, r.memberId, copyId);
      this.log(`group copy queued for ${r.memberId}`);
    }
    this.cancelTimer?.();
    this.cancelTimer =
      next === null
        ? null
        : this.d.scheduler.schedule(next, () => {
            this.serial(() => this.scheduleCopies());
          });
  }

  // ---------------------------------------------------------------- helpers

  private async requireGroup(id: string) {
    const g = await this.d.groups.get(id);
    if (!g) throw new GroupError(`unknown group ${id}`);
    return g;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(e => this.log(`group error: ${String(e)}`));
    return run;
  }

  private changed() {
    this.listeners.forEach(l => l());
  }

  private log(line: string) {
    this.d.log?.(line);
  }
}

function randomU32() {
  const b = randomBytes(4);
  return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
}
