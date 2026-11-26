/**
 * Wavepod envelope header (prototype format, version 1).
 *
 *   offset size  field
 *   0      1     version (high 4 bits) | type (low 4 bits)
 *   1      2     sender key hint (uint16 BE, from SHA-256 of sender public key)
 *   3      4     message id (uint32 BE, random)
 *   7      8     random nonce extension
 *   15     n     ciphertext (n = plaintext length)
 *   15+n   16    Poly1305 tag
 *
 * Bytes 3..14 form the 12-byte ChaCha20-Poly1305 nonce (message id + 8 random bytes).
 * The whole 15-byte header is authenticated as associated data.
 * Fixed overhead: 31 bytes.
 */

export const PROTOCOL_VERSION = 1;
export const HEADER_LENGTH = 15;
export const TAG_LENGTH = 16;
export const OVERHEAD = HEADER_LENGTH + TAG_LENGTH;

/**
 * Meshtastic Data.payload is limited to 233 bytes (mesh.options, protobufs v2.8.3).
 * We keep a margin for Meshtastic PKI encryption of direct messages (to validate in task 02).
 */
export const MESHTASTIC_MAX_PAYLOAD = 233;
export const MAX_ENVELOPE_LENGTH = 200;
export const MAX_PLAINTEXT_LENGTH = MAX_ENVELOPE_LENGTH - OVERHEAD;

export enum MessageType {
  Text = 1,
  Ack = 2,
  /** Encrypted, reliable: carries the sender's beacon key (sent once per contact). */
  Hello = 3,
  /** Broadcast presence beacon (own 9-byte format, see presence/beacon.ts). */
  Beacon = 4,
}

export interface EnvelopeHeader {
  version: number;
  type: MessageType;
  keyHint: number;
  messageId: number;
  /** 12-byte AEAD nonce (message id + random extension). */
  nonce: Uint8Array;
}

export class CodecError extends Error {}

export function encodeHeader(
  type: MessageType,
  keyHint: number,
  messageId: number,
  nonceExtension: Uint8Array,
): Uint8Array {
  if (type < 0 || type > 0x0f) throw new CodecError('type out of range');
  if (keyHint < 0 || keyHint > 0xffff)
    throw new CodecError('key hint out of range');
  if (messageId < 0 || messageId > 0xffffffff)
    throw new CodecError('message id out of range');
  if (nonceExtension.length !== 8)
    throw new CodecError('nonce extension must be 8 bytes');

  const header = new Uint8Array(HEADER_LENGTH);
  const view = new DataView(header.buffer);
  header[0] = (PROTOCOL_VERSION << 4) | type;
  view.setUint16(1, keyHint);
  view.setUint32(3, messageId);
  header.set(nonceExtension, 7);
  return header;
}

export function decodeHeader(envelope: Uint8Array): EnvelopeHeader {
  if (envelope.length < OVERHEAD) throw new CodecError('envelope too short');
  if (envelope.length > MESHTASTIC_MAX_PAYLOAD)
    throw new CodecError('envelope too long');
  const view = new DataView(
    envelope.buffer,
    envelope.byteOffset,
    envelope.byteLength,
  );
  const version = envelope[0] >> 4;
  if (version !== PROTOCOL_VERSION)
    throw new CodecError(`unsupported version ${version}`);
  const type = envelope[0] & 0x0f;
  if (!(type in MessageType)) throw new CodecError(`unknown type ${type}`);
  return {
    version,
    type,
    keyHint: view.getUint16(1),
    messageId: view.getUint32(3),
    nonce: envelope.slice(3, 15),
  };
}

/** Ack body: one or more 4-byte message ids, so several acks fit in one packet. */
export function encodeAckBody(messageIds: number[]): Uint8Array {
  if (messageIds.length === 0) throw new CodecError('empty ack');
  const body = new Uint8Array(messageIds.length * 4);
  const view = new DataView(body.buffer);
  messageIds.forEach((id, i) => view.setUint32(i * 4, id));
  return body;
}

export function decodeAckBody(body: Uint8Array): number[] {
  if (body.length === 0 || body.length % 4 !== 0)
    throw new CodecError('malformed ack');
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const ids: number[] = [];
  for (let i = 0; i < body.length; i += 4) ids.push(view.getUint32(i));
  return ids;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function encodeText(text: string): Uint8Array {
  const bytes = encoder.encode(text);
  if (bytes.length === 0) throw new CodecError('empty text');
  if (bytes.length > MAX_PLAINTEXT_LENGTH) {
    throw new CodecError(
      `text too long: ${bytes.length} > ${MAX_PLAINTEXT_LENGTH} bytes`,
    );
  }
  return bytes;
}

export function decodeText(bytes: Uint8Array): string {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new CodecError('invalid UTF-8');
  }
}
