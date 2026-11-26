/**
 * Delivery engine: persistent outbox, presence-gated sending, retries, probe,
 * two-level acks, de-duplication. Sits between the UI and the RadioInterface.
 *
 * Every state change runs in one serial queue, so radio events (which can arrive
 * before radio.send() resolves) never interleave with a send in progress.
 */
import type {
  RadioAck,
  RadioInterface,
  RadioPacket,
  Unsubscribe,
} from '../radio/RadioInterface';
import {
  deriveSessionKey,
  open,
  randomMessageId,
  seal,
  type Identity,
} from '../crypto/envelope';
import {
  MessageType,
  decodeAckBody,
  decodeHeader,
  decodeText,
  encodeAckBody,
  encodeText,
} from '../protocol/codec';
import { ContactsRepository, type Contact } from '../storage/contacts';
import {
  DedupRepository,
  MessagesRepository,
  OutboxRepository,
} from '../storage/delivery';
import type { SqlDatabase } from '../storage/types';
import { DEFAULT_POLICY, burstSize, type DeliveryPolicy } from './policy';
import { BEACON_KEY_LENGTH, isBeacon } from '../presence/beacon';
import { decide, type OutboxEntry } from './schedule';

export interface Scheduler {
  now(): number;
  /** Runs fn at (or after) `at`. Returns a cancel function. */
  schedule(at: number, fn: () => void): () => void;
}

export const realScheduler: Scheduler = {
  now: () => Date.now(),
  schedule(at, fn) {
    const delay = Math.min(Math.max(0, at - Date.now()), 2 ** 31 - 1);
    const t = setTimeout(fn, delay);
    return () => clearTimeout(t);
  },
};

export type EngineEvent =
  | {
      kind: 'message';
      contactId: string;
      direction: 'in' | 'out';
      messageId: number;
    }
  | { kind: 'contact'; contactId: string }
  /** A contact sent us its beacon key (Hello). */
  | { kind: 'hello'; contactId: string; beaconKey: Uint8Array }
  | { kind: 'log'; line: string };

export interface EngineDeps {
  radio: RadioInterface;
  me: Identity;
  db: SqlDatabase;
  scheduler?: Scheduler;
  policy?: DeliveryPolicy;
  /** False in discreet mode: no spontaneous probe for unreachable contacts. */
  allowProbe?: () => boolean;
}

export class DeliveryEngine {
  readonly contacts: ContactsRepository;
  readonly messages: MessagesRepository;
  private readonly outbox: OutboxRepository;
  private readonly dedup: DedupRepository;
  private readonly radio: RadioInterface;
  private readonly me: Identity;
  private readonly clock: Scheduler;
  private readonly policy: DeliveryPolicy;
  private readonly keys = new Map<string, Uint8Array>();
  private readonly listeners = new Set<(e: EngineEvent) => void>();
  private subscriptions: Unsubscribe[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private cancelTimer: (() => void) | null = null;
  private timerAt: number | null = null;
  private nextSendAt = 0;
  private readonly allowProbe: () => boolean;
  private started = false;

  constructor(deps: EngineDeps) {
    this.radio = deps.radio;
    this.me = deps.me;
    this.clock = deps.scheduler ?? realScheduler;
    this.policy = deps.policy ?? DEFAULT_POLICY;
    this.allowProbe = deps.allowProbe ?? (() => true);
    this.contacts = new ContactsRepository(deps.db, () => this.clock.now());
    this.messages = new MessagesRepository(deps.db);
    this.outbox = new OutboxRepository(deps.db);
    this.dedup = new DedupRepository(deps.db);
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.subscriptions = [
      this.radio.onReceive(p => this.enqueue(() => this.handlePacket(p))),
      this.radio.onAck(a => this.enqueue(() => this.handleRadioAck(a))),
      this.radio.onConnectionState(s => {
        if (s === 'ready') this.kick();
      }),
    ];
    this.enqueue(() =>
      this.dedup.purgeBefore(this.clock.now() - this.policy.dedupRetentionMs),
    );
    this.kick();
  }

  stop() {
    this.started = false;
    this.subscriptions.forEach(u => u());
    this.subscriptions = [];
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.timerAt = null;
  }

  onEvent(l: (e: EngineEvent) => void): Unsubscribe {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Waits until every queued operation has run (tests, shutdown). */
  idle(): Promise<void> {
    return this.queue.then(() => undefined);
  }

  /**
   * Sends our beacon key to a contact (reliable, acknowledged, not shown in the
   * conversation). Lets the contact recognise our presence beacons.
   */
  sendHello(contactId: string, beaconKey: Uint8Array): Promise<number> {
    return this.enqueue(async () => {
      const contact = await this.requireContact(contactId);
      const now = this.clock.now();
      const messageId = randomMessageId();
      await this.outbox.add({
        contactId,
        messageId,
        envelope: seal(
          MessageType.Hello,
          beaconKey,
          this.me.publicKey,
          this.sessionKey(contact),
          messageId,
        ),
        createdAt: now,
        expiresAt: now + this.policy.ttlMs,
        attempts: 0,
        burstAttempts: 0,
        lastAttemptAt: null,
        packetId: null,
        forced: false,
      });
      await this.tick();
      return messageId;
    });
  }

  sendText(contactId: string, text: string): Promise<number> {
    const body = encodeText(text); // validates length before queuing
    return this.enqueue(async () => {
      const contact = await this.requireContact(contactId);
      const now = this.clock.now();
      const messageId = randomMessageId();
      const envelope = seal(
        MessageType.Text,
        body,
        this.me.publicKey,
        this.sessionKey(contact),
        messageId,
      );
      await this.messages.insert({
        contactId,
        direction: 'out',
        messageId,
        body: text,
        status: 'pending',
        createdAt: now,
      });
      await this.outbox.add({
        contactId,
        messageId,
        envelope,
        createdAt: now,
        expiresAt: now + this.policy.ttlMs,
        attempts: 0,
        burstAttempts: 0,
        lastAttemptAt: null,
        packetId: null,
        forced: false,
      });
      this.emit({ kind: 'message', contactId, direction: 'out', messageId });
      await this.tick();
      return messageId;
    });
  }

  /** Manual resend: a failed message gets a fresh TTL; a waiting one starts a burst now. */
  resend(contactId: string, messageId: number): Promise<void> {
    return this.enqueue(async () => {
      const now = this.clock.now();
      const msg = await this.messages.get(contactId, 'out', messageId);
      if (!msg || msg.status === 'delivered' || msg.status === 'read') return;
      const entry = await this.outbox.get(contactId, messageId);
      if (entry) {
        await this.outbox.restart(
          contactId,
          messageId,
          now + this.policy.ttlMs,
        );
      } else {
        // Failed and removed from the outbox: rebuild it.
        const contact = await this.requireContact(contactId);
        await this.outbox.add({
          contactId,
          messageId,
          envelope: seal(
            MessageType.Text,
            encodeText(msg.body),
            this.me.publicKey,
            this.sessionKey(contact),
            messageId,
          ),
          createdAt: now,
          expiresAt: now + this.policy.ttlMs,
          attempts: 0,
          burstAttempts: 0,
          lastAttemptAt: null,
          packetId: null,
          forced: true,
        });
      }
      await this.messages.reopen(contactId, messageId, now);
      this.emit({ kind: 'message', contactId, direction: 'out', messageId });
      await this.tick();
    });
  }

  /** Cancels a message that is not delivered yet. */
  cancel(contactId: string, messageId: number): Promise<void> {
    return this.enqueue(async () => {
      await this.outbox.remove(contactId, messageId);
      await this.messages.remove(contactId, messageId);
      this.emit({ kind: 'message', contactId, direction: 'out', messageId });
    });
  }

  /** External presence signal (QR scan, Meshtastic last_heard, beacon...). */
  signal(contactId: string, nodeNum: number, at = this.clock.now()) {
    return this.enqueue(async () => {
      await this.onContactSignal(contactId, nodeNum, at);
      await this.tick();
    });
  }

  // ---------------------------------------------------------------- internals

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(e => this.log(`error: ${String(e)}`));
    return run;
  }

  /** Schedules a tick through the queue. */
  private kick() {
    this.enqueue(() => this.tick());
  }

  private async tick(): Promise<void> {
    if (!this.started) return;
    const now = this.clock.now();
    const entries = await this.outbox.all();
    const contacts = new Map<string, Contact>();
    const oldest = new Set<string>();
    let wake: number | null = null;
    const wakeAt = (t: number | null) => {
      if (t !== null && (wake === null || t < wake)) wake = t;
    };
    let sent = false;

    for (const e of entries) {
      let c = contacts.get(e.contactId);
      if (!c) {
        c = (await this.contacts.get(e.contactId)) ?? undefined;
        if (!c) {
          await this.outbox.remove(e.contactId, e.messageId);
          continue;
        }
        contacts.set(e.contactId, c);
      }
      const isOldest = !oldest.has(e.contactId);
      oldest.add(e.contactId);

      let d = decide(e, c, isOldest, now, this.policy);
      if (d.kind === 'send' && d.probe && !this.allowProbe()) {
        d = { kind: 'wait', until: e.expiresAt };
      }
      if (d.kind === 'expire') {
        await this.outbox.remove(e.contactId, e.messageId);
        await this.messages.advance(
          e.contactId,
          e.messageId,
          'failed',
          now,
          'expired',
        );
        this.log(`expired ${hex(e.messageId)}`);
        this.emit({
          kind: 'message',
          contactId: e.contactId,
          direction: 'out',
          messageId: e.messageId,
        });
      } else if (d.kind === 'wait') {
        wakeAt(d.until);
      } else if (
        sent ||
        now < this.nextSendAt ||
        this.radio.connectionState !== 'ready'
      ) {
        // One transmission per tick, spaced. While the radio is down, only the
        // expiry needs a timer: the 'ready' event triggers a new tick.
        if (this.radio.connectionState === 'ready') {
          wakeAt(Math.max(this.nextSendAt, now + 1));
        } else {
          wakeAt(e.expiresAt);
        }
      } else {
        sent = await this.attempt(e, c, d.probe, now);
        if (!sent) wakeAt(now + this.policy.spacingMs);
        else if (d.probe) c.lastProbeAt = now;
      }
    }
    if (sent) wakeAt(this.nextSendAt);
    this.arm(wake);
  }

  private async attempt(
    e: OutboxEntry,
    c: Contact,
    probe: boolean,
    now: number,
  ) {
    let packetId: number;
    try {
      packetId = await this.radio.send(e.envelope, c.nodeNum!, {
        wantAck: true,
      });
    } catch (err) {
      this.log(`send failed for ${hex(e.messageId)}: ${String(err)}`);
      return false;
    }
    const burst = probe ? burstSize(this.policy) : e.burstAttempts + 1;
    await this.outbox.recordAttempt(e, packetId, burst, now);
    if (probe) await this.contacts.setLastProbe(c.id, now);
    this.nextSendAt = now + this.policy.spacingMs;
    if (await this.messages.advance(e.contactId, e.messageId, 'sent', now)) {
      this.emit({
        kind: 'message',
        contactId: e.contactId,
        direction: 'out',
        messageId: e.messageId,
      });
    }
    this.log(
      `${probe ? 'probe' : `attempt ${burst}`} ${hex(e.messageId)} → ${hex(
        c.nodeNum!,
      )} (packet ${hex(packetId)})`,
    );
    return true;
  }

  private arm(at: number | null) {
    if (at === this.timerAt) return;
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.timerAt = at;
    if (at !== null && this.started) {
      this.cancelTimer = this.clock.schedule(at, () => {
        this.timerAt = null;
        this.cancelTimer = null;
        this.kick();
      });
    }
  }

  private async handleRadioAck(ack: RadioAck) {
    const e = await this.outbox.findByPacketId(ack.packetId);
    if (!e) return;
    const c = await this.contacts.get(e.contactId);
    if (!ack.ok) {
      this.log(`radio error for ${hex(e.messageId)}: ${ack.error}`);
      return; // the retry schedule handles it
    }
    if (c && ack.from === c.nodeNum) {
      // The destination module answered: proof of presence too.
      if (
        await this.messages.advance(
          e.contactId,
          e.messageId,
          'moduleAck',
          this.clock.now(),
        )
      ) {
        this.emit({
          kind: 'message',
          contactId: e.contactId,
          direction: 'out',
          messageId: e.messageId,
        });
      }
      await this.contacts.markSeen(c.id, ack.from, this.clock.now());
    }
  }

  private async handlePacket(packet: RadioPacket) {
    if (isBeacon(packet.payload)) return; // handled by the presence service
    let hint: number;
    try {
      hint = decodeHeader(packet.payload).keyHint;
    } catch (e) {
      this.log(`bad header from ${hex(packet.from)}: ${String(e)}`);
      return;
    }
    let contact: Contact | null = null;
    let opened: ReturnType<typeof open> | null = null;
    for (const candidate of await this.contacts.findByKeyHint(hint)) {
      try {
        opened = open(packet.payload, this.sessionKey(candidate));
        contact = candidate;
        break;
      } catch {
        // try the next contact sharing this hint
      }
    }
    if (!contact || !opened) {
      this.log(`ignored packet from ${hex(packet.from)} (unknown sender)`);
      return;
    }
    const now = this.clock.now();
    await this.onContactSignal(contact.id, packet.from, now);

    if (opened.type === MessageType.Text) {
      // Always ack, duplicates included: the previous ack may have been lost.
      await this.sendAppAck(contact, [opened.messageId], packet.from);
      if (await this.dedup.firstSeen(contact.id, opened.messageId, now)) {
        await this.messages.insert({
          contactId: contact.id,
          direction: 'in',
          messageId: opened.messageId,
          body: decodeText(opened.plaintext),
          status: 'received',
          createdAt: now,
        });
        this.emit({
          kind: 'message',
          contactId: contact.id,
          direction: 'in',
          messageId: opened.messageId,
        });
      } else {
        this.log(`duplicate ${hex(opened.messageId)} from ${contact.name}`);
      }
    } else if (opened.type === MessageType.Hello) {
      await this.sendAppAck(contact, [opened.messageId], packet.from);
      if (opened.plaintext.length === BEACON_KEY_LENGTH) {
        this.emit({
          kind: 'hello',
          contactId: contact.id,
          beaconKey: opened.plaintext,
        });
      }
    } else if (opened.type === MessageType.Ack) {
      for (const id of decodeAckBody(opened.plaintext)) {
        await this.outbox.remove(contact.id, id);
        if (await this.messages.advance(contact.id, id, 'delivered', now)) {
          this.log(`delivered ${hex(id)}`);
          this.emit({
            kind: 'message',
            contactId: contact.id,
            direction: 'out',
            messageId: id,
          });
        }
      }
    }
    await this.tick();
  }

  private async onContactSignal(
    contactId: string,
    nodeNum: number,
    at: number,
  ) {
    await this.contacts.markSeen(contactId, nodeNum, at);
    await this.outbox.resetExhausted(contactId, burstSize(this.policy));
    this.emit({ kind: 'contact', contactId });
  }

  private async sendAppAck(contact: Contact, ids: number[], to: number) {
    if (this.radio.connectionState !== 'ready') return;
    const envelope = seal(
      MessageType.Ack,
      encodeAckBody(ids),
      this.me.publicKey,
      this.sessionKey(contact),
    );
    try {
      await this.radio.send(envelope, to, { wantAck: false });
    } catch (e) {
      this.log(`ack send failed: ${String(e)}`);
    }
  }

  private sessionKey(c: Contact) {
    let k = this.keys.get(c.id);
    if (!k) {
      k = deriveSessionKey(this.me, c.publicKey);
      this.keys.set(c.id, k);
    }
    return k;
  }

  private async requireContact(id: string) {
    const c = await this.contacts.get(id);
    if (!c) throw new Error(`unknown contact ${id}`);
    return c;
  }

  private emit(e: EngineEvent) {
    this.listeners.forEach(l => l(e));
  }

  private log(line: string) {
    this.emit({ kind: 'log', line });
  }
}

const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
