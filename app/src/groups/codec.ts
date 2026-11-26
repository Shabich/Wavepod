/**
 * Group message bodies (inside encrypted envelopes, see protocol/codec.ts).
 *
 *   GroupInvite  (DM)        groupId 8 | key 32 | nameLen 1 | name ≤ 40
 *   GroupRoster  (DM)        groupId 8 | count 1 | count × member
 *       member:              publicKey 32 | nodeNum 4 | icon 1 | color 1 | nameLen 1 | name ≤ 12
 *   GroupMessage (broadcast) senderId 8 | text
 *   GroupAck     (unicast)   ackerId 8 | messageId 4 × n
 *   GroupCopy    (DM)        groupId 8 | messageId 4 | senderId 8 | text
 *
 * Ids are 8 bytes (16 hex chars): contact ids, derived from public keys.
 * Group text is limited so that the DM copy still fits in one packet.
 */
import { MAX_PLAINTEXT_LENGTH } from '../protocol/codec';

export const ID_BYTES = 8;
export const GROUP_KEY_BYTES = 32;
export const MAX_GROUP_NAME = 40;
export const ROSTER_NAME_BYTES = 12;
export const ROSTER_PER_MESSAGE = 3;
/** 169 − (groupId 8 + messageId 4 + senderId 8) for the DM copy. */
export const MAX_GROUP_TEXT = MAX_PLAINTEXT_LENGTH - 20;
export const MAX_GROUP_MEMBERS = 8;

export class GroupCodecError extends Error {}

const enc = new TextEncoder();
const dec = () => new TextDecoder('utf-8', { fatal: true });

export function idToBytes(id: string): Uint8Array {
  if (!/^[0-9a-f]{16}$/.test(id)) throw new GroupCodecError('bad id');
  const out = new Uint8Array(ID_BYTES);
  for (let i = 0; i < ID_BYTES; i++)
    out[i] = parseInt(id.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToId(b: Uint8Array): string {
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

/** 2-byte hint identifying the group in envelope headers. */
export function groupHint(groupId: string) {
  const b = idToBytes(groupId);
  return (b[0] << 8) | b[1];
}

/** Truncates UTF-8 text to a byte budget without cutting a character. */
export function truncateUtf8(text: string, maxBytes: number): string {
  let out = '';
  for (const ch of text) {
    if (enc.encode(out + ch).length > maxBytes) break;
    out += ch;
  }
  return out;
}

function decodeText(b: Uint8Array) {
  try {
    return dec().decode(b);
  } catch {
    throw new GroupCodecError('invalid text');
  }
}

// ---------------------------------------------------------------- invite

export interface GroupInvite {
  groupId: string;
  key: Uint8Array;
  name: string;
}

export function encodeInvite(i: GroupInvite): Uint8Array {
  const name = enc.encode(i.name.trim());
  if (!name.length || name.length > MAX_GROUP_NAME)
    throw new GroupCodecError('bad name');
  if (i.key.length !== GROUP_KEY_BYTES) throw new GroupCodecError('bad key');
  const out = new Uint8Array(ID_BYTES + GROUP_KEY_BYTES + 1 + name.length);
  out.set(idToBytes(i.groupId), 0);
  out.set(i.key, ID_BYTES);
  out[40] = name.length;
  out.set(name, 41);
  return out;
}

export function decodeInvite(b: Uint8Array): GroupInvite {
  if (b.length < 42 || b.length !== 41 + b[40])
    throw new GroupCodecError('bad invite');
  return {
    groupId: bytesToId(b.slice(0, 8)),
    key: b.slice(8, 40),
    name: decodeText(b.slice(41)),
  };
}

// ---------------------------------------------------------------- roster

export interface RosterMember {
  publicKey: Uint8Array;
  nodeNum: number;
  avatar: { icon: number; color: number };
  name: string;
}

export function encodeRoster(
  groupId: string,
  members: RosterMember[],
): Uint8Array {
  if (members.length === 0 || members.length > ROSTER_PER_MESSAGE) {
    throw new GroupCodecError('bad roster size');
  }
  const parts: number[] = [...idToBytes(groupId), members.length];
  for (const m of members) {
    if (m.publicKey.length !== 32) throw new GroupCodecError('bad key');
    const name = enc.encode(truncateUtf8(m.name.trim(), ROSTER_NAME_BYTES));
    const node = new Uint8Array(4);
    new DataView(node.buffer).setUint32(0, m.nodeNum >>> 0);
    parts.push(
      ...m.publicKey,
      ...node,
      m.avatar.icon,
      m.avatar.color,
      name.length,
      ...name,
    );
  }
  return Uint8Array.from(parts);
}

export function decodeRoster(b: Uint8Array): {
  groupId: string;
  members: RosterMember[];
} {
  if (b.length < 9) throw new GroupCodecError('bad roster');
  const groupId = bytesToId(b.slice(0, 8));
  const count = b[8];
  if (count === 0 || count > ROSTER_PER_MESSAGE)
    throw new GroupCodecError('bad roster');
  const members: RosterMember[] = [];
  let at = 9;
  for (let i = 0; i < count; i++) {
    if (at + 39 > b.length) throw new GroupCodecError('bad roster');
    const publicKey = b.slice(at, at + 32);
    const nodeNum = new DataView(b.buffer, b.byteOffset + at + 32, 4).getUint32(
      0,
    );
    const icon = b[at + 36];
    const color = b[at + 37];
    const nameLen = b[at + 38];
    if (nameLen > ROSTER_NAME_BYTES || at + 39 + nameLen > b.length) {
      throw new GroupCodecError('bad roster');
    }
    members.push({
      publicKey,
      nodeNum,
      avatar: { icon, color },
      name: decodeText(b.slice(at + 39, at + 39 + nameLen)),
    });
    at += 39 + nameLen;
  }
  if (at !== b.length) throw new GroupCodecError('bad roster');
  return { groupId, members };
}

// ---------------------------------------------------------------- message / ack / copy

export function encodeGroupText(senderId: string, text: string): Uint8Array {
  const body = enc.encode(text);
  if (!body.length) throw new GroupCodecError('empty text');
  if (body.length > MAX_GROUP_TEXT) throw new GroupCodecError('text too long');
  const out = new Uint8Array(ID_BYTES + body.length);
  out.set(idToBytes(senderId));
  out.set(body, ID_BYTES);
  return out;
}

export function decodeGroupText(b: Uint8Array): {
  senderId: string;
  text: string;
} {
  if (b.length <= ID_BYTES) throw new GroupCodecError('bad group text');
  return { senderId: bytesToId(b.slice(0, 8)), text: decodeText(b.slice(8)) };
}

export function encodeGroupAck(
  ackerId: string,
  messageIds: number[],
): Uint8Array {
  if (!messageIds.length) throw new GroupCodecError('empty ack');
  const out = new Uint8Array(ID_BYTES + 4 * messageIds.length);
  out.set(idToBytes(ackerId));
  const v = new DataView(out.buffer);
  messageIds.forEach((id, i) => v.setUint32(ID_BYTES + 4 * i, id >>> 0));
  return out;
}

export function decodeGroupAck(b: Uint8Array): {
  ackerId: string;
  messageIds: number[];
} {
  if (b.length < 12 || (b.length - 8) % 4 !== 0)
    throw new GroupCodecError('bad group ack');
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ids: number[] = [];
  for (let at = 8; at < b.length; at += 4) ids.push(v.getUint32(at));
  return { ackerId: bytesToId(b.slice(0, 8)), messageIds: ids };
}

export interface GroupCopy {
  groupId: string;
  messageId: number;
  senderId: string;
  text: string;
}

export function encodeGroupCopy(c: GroupCopy): Uint8Array {
  const body = enc.encode(c.text);
  if (!body.length || body.length > MAX_GROUP_TEXT)
    throw new GroupCodecError('bad text');
  const out = new Uint8Array(20 + body.length);
  out.set(idToBytes(c.groupId), 0);
  new DataView(out.buffer).setUint32(8, c.messageId >>> 0);
  out.set(idToBytes(c.senderId), 12);
  out.set(body, 20);
  return out;
}

export function decodeGroupCopy(b: Uint8Array): GroupCopy {
  if (b.length <= 20) throw new GroupCodecError('bad group copy');
  return {
    groupId: bytesToId(b.slice(0, 8)),
    messageId: new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(8),
    senderId: bytesToId(b.slice(12, 20)),
    text: decodeText(b.slice(20)),
  };
}
