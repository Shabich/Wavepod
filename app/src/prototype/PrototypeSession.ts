/**
 * Prototype (task 01) logic: one peer, hardcoded test identities, text + app-level ack.
 * Replaced by the real outbox (task 05) and identities (task 03).
 */
import { sha256 } from '@noble/hashes/sha2.js';
import type {
  RadioAck,
  RadioInterface,
  RadioPacket,
  Unsubscribe,
} from '../radio/RadioInterface';
import {
  EnvelopeError,
  deriveSessionKey,
  identityFromSeed,
  keyHint,
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

export type Role = 'A' | 'B';

export function testIdentity(role: Role): Identity {
  return identityFromSeed(
    sha256(new TextEncoder().encode(`wavepod-prototype-${role}`)),
  );
}

export type OutgoingStatus =
  | 'sending'
  | 'sent'
  | 'moduleAck'
  | 'delivered'
  | 'failed';

export interface ChatMessage {
  messageId: number;
  direction: 'out' | 'in';
  text: string;
  at: number;
  status?: OutgoingStatus;
  error?: string;
  packetId?: number;
  rxSnr?: number;
  rxRssi?: number;
  hops?: number;
}

export class PrototypeSession {
  readonly me: Identity;
  readonly peer: Identity['publicKey'];
  private readonly sessionKey: Uint8Array;
  private readonly peerHint: number;
  private readonly byMessageId = new Map<number, ChatMessage>();
  private readonly byPacketId = new Map<number, ChatMessage>();
  private readonly seenIncoming = new Set<number>();
  private readonly earlyAcks = new Map<number, RadioAck>();
  private readonly listeners = new Set<() => void>();
  private readonly subscriptions: Unsubscribe[];
  readonly messages: ChatMessage[] = [];
  readonly log: string[] = [];
  peerNode: number | undefined;

  constructor(
    private readonly radio: RadioInterface,
    role: Role,
    private readonly now = () => Date.now(),
  ) {
    this.me = testIdentity(role);
    this.peer = testIdentity(role === 'A' ? 'B' : 'A').publicKey;
    this.sessionKey = deriveSessionKey(this.me, this.peer);
    this.peerHint = keyHint(this.peer);
    this.subscriptions = [
      radio.onReceive(p => this.handlePacket(p)),
      radio.onAck(a => this.handleRadioAck(a)),
    ];
  }

  dispose() {
    this.subscriptions.forEach(u => u());
  }

  onChange(l: () => void): Unsubscribe {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  async sendText(text: string): Promise<ChatMessage> {
    if (this.peerNode === undefined) throw new Error('no peer node selected');
    const messageId = randomMessageId();
    const envelope = seal(
      MessageType.Text,
      encodeText(text),
      this.me.publicKey,
      this.sessionKey,
      messageId,
    );
    const msg: ChatMessage = {
      messageId,
      direction: 'out',
      text,
      at: this.now(),
      status: 'sending',
    };
    this.byMessageId.set(messageId, msg);
    this.messages.push(msg);
    this.changed();
    try {
      msg.packetId = await this.radio.send(envelope, this.peerNode, {
        wantAck: true,
      });
      this.byPacketId.set(msg.packetId, msg);
      // Acks may arrive over BLE before the write resolves: never downgrade, replay early acks.
      if (msg.status === 'sending') msg.status = 'sent';
      this.note(
        `sent msg ${hex(messageId)} as packet ${hex(msg.packetId)} (${
          envelope.length
        } B)`,
      );
      const early = this.earlyAcks.get(msg.packetId);
      if (early) {
        this.earlyAcks.delete(msg.packetId);
        this.handleRadioAck(early);
      }
    } catch (e) {
      msg.status = 'failed';
      msg.error = String(e);
    }
    this.changed();
    return msg;
  }

  private handleRadioAck(ack: RadioAck) {
    const msg = this.byPacketId.get(ack.packetId);
    if (!msg) {
      this.earlyAcks.set(ack.packetId, ack);
      if (this.earlyAcks.size > 50)
        this.earlyAcks.delete(this.earlyAcks.keys().next().value!);
      return;
    }
    if (!ack.ok) {
      this.note(`radio error for ${hex(msg.messageId)}: ${ack.error}`);
      if (msg.status !== 'delivered') {
        msg.status = 'failed';
        msg.error = ack.error;
      }
    } else if (ack.from === this.peerNode) {
      if (msg.status === 'sent' || msg.status === 'sending')
        msg.status = 'moduleAck';
      this.note(`module ack for ${hex(msg.messageId)}`);
    } else {
      // Implicit ack from our own module or a relay: the packet left, nothing more.
      this.note(`implicit ack for ${hex(msg.messageId)} from ${hex(ack.from)}`);
    }
    this.changed();
  }

  private handlePacket(packet: RadioPacket) {
    let header;
    try {
      header = decodeHeader(packet.payload);
    } catch (e) {
      this.note(`bad header from ${hex(packet.from)}: ${String(e)}`);
      return;
    }
    if (header.keyHint !== this.peerHint) {
      this.note(`packet from unknown key hint ${hex(header.keyHint)}`);
      return;
    }
    let opened;
    try {
      opened = open(packet.payload, this.sessionKey);
    } catch (e) {
      this.note(
        `decrypt failed from ${hex(packet.from)}: ${
          e instanceof EnvelopeError ? e.message : String(e)
        }`,
      );
      return;
    }
    if (this.peerNode === undefined) this.peerNode = packet.from;

    if (opened.type === MessageType.Text) {
      // Always ack, even duplicates: the first ack may have been lost.
      void this.sendAck(opened.messageId, packet.from);
      if (this.seenIncoming.has(opened.messageId)) {
        this.note(`duplicate ${hex(opened.messageId)} ignored`);
        return;
      }
      this.seenIncoming.add(opened.messageId);
      this.messages.push({
        messageId: opened.messageId,
        direction: 'in',
        text: decodeText(opened.plaintext),
        at: this.now(),
        packetId: packet.packetId,
        rxSnr: packet.rxSnr,
        rxRssi: packet.rxRssi,
        hops:
          packet.hopStart !== undefined && packet.hopLimit !== undefined
            ? packet.hopStart - packet.hopLimit
            : undefined,
      });
    } else if (opened.type === MessageType.Ack) {
      for (const id of decodeAckBody(opened.plaintext)) {
        const msg = this.byMessageId.get(id);
        if (msg) {
          msg.status = 'delivered';
          msg.error = undefined;
          this.note(`app ack for ${hex(id)}`);
        }
      }
    }
    this.changed();
  }

  private async sendAck(messageId: number, to: number) {
    const envelope = seal(
      MessageType.Ack,
      encodeAckBody([messageId]),
      this.me.publicKey,
      this.sessionKey,
    );
    try {
      await this.radio.send(envelope, to, { wantAck: false });
    } catch (e) {
      this.note(`ack send failed: ${String(e)}`);
    }
  }

  private note(line: string) {
    this.log.unshift(
      `${new Date(this.now()).toISOString().slice(11, 19)} ${line}`,
    );
    if (this.log.length > 200) this.log.pop();
  }

  private changed() {
    this.listeners.forEach(l => l());
  }
}

function hex(n: number) {
  return (n >>> 0).toString(16).padStart(8, '0');
}
