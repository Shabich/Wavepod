/**
 * Wavepod end-to-end encryption, done on the phone before Meshtastic sees anything.
 *
 * Direct messages: X25519 static key agreement, HKDF-SHA256 to a 32-byte session key,
 * ChaCha20-Poly1305 with a 12-byte random nonce carried in the header.
 * No forward secrecy yet (see WAVEPOD.md).
 */
import { x25519 } from '@noble/curves/ed25519.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import {
  CodecError,
  HEADER_LENGTH,
  MAX_PLAINTEXT_LENGTH,
  MessageType,
  decodeHeader,
  encodeHeader,
} from '../protocol/codec';

export interface Identity {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface OpenedEnvelope {
  type: MessageType;
  messageId: number;
  keyHint: number;
  plaintext: Uint8Array;
}

export class EnvelopeError extends Error {}

const DM_INFO = new TextEncoder().encode('wavepod/v1/dm');

export function generateIdentity(): Identity {
  const secretKey = x25519.utils.randomSecretKey();
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

/** Deterministic identity from a 32-byte seed. For tests and the prototype only. */
export function identityFromSeed(seed: Uint8Array): Identity {
  if (seed.length !== 32) throw new EnvelopeError('seed must be 32 bytes');
  const secretKey = sha256(seed);
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

/** 2-byte hint so the receiver picks the right contact key without trial decryption. */
export function keyHint(publicKey: Uint8Array): number {
  const h = sha256(publicKey);
  return (h[0] << 8) | h[1];
}

/** Stable contact address derived from the public key (never from position or node number). */
export function contactId(publicKey: Uint8Array): string {
  return toHex(sha256(publicKey).slice(0, 8));
}

/** Shared session key for a pair of identities. Both sides derive the same key. */
export function deriveSessionKey(
  me: Identity,
  theirPublicKey: Uint8Array,
): Uint8Array {
  if (theirPublicKey.length !== 32)
    throw new EnvelopeError('public key must be 32 bytes');
  const shared = x25519.getSharedSecret(me.secretKey, theirPublicKey);
  if (shared.every(b => b === 0)) throw new EnvelopeError('invalid public key');
  const [a, b] = sortKeys(me.publicKey, theirPublicKey);
  const info = concat(DM_INFO, a, b);
  return hkdf(sha256, shared, undefined, info, 32);
}

export function seal(
  type: MessageType,
  plaintext: Uint8Array,
  senderPublicKey: Uint8Array,
  sessionKey: Uint8Array,
  messageId: number = randomMessageId(),
): Uint8Array {
  return sealWithHint(
    type,
    plaintext,
    keyHint(senderPublicKey),
    sessionKey,
    messageId,
  );
}

/** Same envelope, with an explicit 2-byte hint (group messages use the group's). */
export function sealWithHint(
  type: MessageType,
  plaintext: Uint8Array,
  hint: number,
  key: Uint8Array,
  messageId: number = randomMessageId(),
): Uint8Array {
  if (plaintext.length > MAX_PLAINTEXT_LENGTH)
    throw new EnvelopeError('plaintext too long');
  const header = encodeHeader(type, hint, messageId, randomBytes(8));
  const nonce = header.slice(3, 15);
  const sealed = chacha20poly1305(key, nonce, header).encrypt(plaintext);
  return concat(header, sealed);
}

export function open(
  envelope: Uint8Array,
  sessionKey: Uint8Array,
): OpenedEnvelope {
  let header;
  try {
    header = decodeHeader(envelope);
  } catch (e) {
    throw new EnvelopeError(e instanceof CodecError ? e.message : 'bad header');
  }
  const aad = envelope.slice(0, HEADER_LENGTH);
  let plaintext: Uint8Array;
  try {
    plaintext = chacha20poly1305(sessionKey, header.nonce, aad).decrypt(
      envelope.slice(HEADER_LENGTH),
    );
  } catch {
    throw new EnvelopeError('authentication failed');
  }
  return {
    type: header.type,
    messageId: header.messageId,
    keyHint: header.keyHint,
    plaintext,
  };
}

export function randomMessageId(): number {
  const b = randomBytes(4);
  return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function sortKeys(a: Uint8Array, b: Uint8Array): [Uint8Array, Uint8Array] {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? [a, b] : [b, a];
  }
  return [a, b];
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
