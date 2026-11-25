/**
 * Wavepod contact card, shown as a QR code: "wavepod://add#<base64url>".
 *
 *   offset  size  field
 *   0       1     version (1)
 *   1       32    X25519 public key (messages)
 *   33      32    Ed25519 public key (signs this card)
 *   65      1     name length n (<= 40)
 *   66      n     name, UTF-8
 *   66+n    1     Meshtastic contact length m (0 if no module was connected)
 *   67+n    m     Meshtastic SharedContact protobuf (node number + user + module public key),
 *                 injected as-is into the scanner's module with AdminMessage.add_contact
 *   67+n+m  64    Ed25519 signature of all previous bytes
 *
 * The signature binds the keys, name and module together: a card cannot be altered
 * piecewise. It does not prove who created it; the safety number does that.
 */
import { ed25519 } from '@noble/curves/ed25519.js';

export const CARD_VERSION = 1;
export const CARD_URL_PREFIX = 'wavepod://add#';
export const MAX_NAME_BYTES = 40;
export const MAX_MESH_CONTACT_BYTES = 200;

export interface ContactCard {
  boxPublicKey: Uint8Array;
  signPublicKey: Uint8Array;
  name: string;
  /** Meshtastic SharedContact bytes, or null if the owner had no module connected. */
  meshContact: Uint8Array | null;
}

export class CardError extends Error {}

const enc = new TextEncoder();

export function encodeCard(
  card: ContactCard,
  signSecretKey: Uint8Array,
): string {
  const name = enc.encode(card.name.trim());
  if (name.length === 0) throw new CardError('name is empty');
  if (name.length > MAX_NAME_BYTES) throw new CardError('name too long');
  const mesh = card.meshContact ?? new Uint8Array(0);
  if (mesh.length > MAX_MESH_CONTACT_BYTES)
    throw new CardError('module info too long');
  if (card.boxPublicKey.length !== 32 || card.signPublicKey.length !== 32) {
    throw new CardError('keys must be 32 bytes');
  }
  const body = new Uint8Array(67 + name.length + mesh.length);
  body[0] = CARD_VERSION;
  body.set(card.boxPublicKey, 1);
  body.set(card.signPublicKey, 33);
  body[65] = name.length;
  body.set(name, 66);
  body[66 + name.length] = mesh.length;
  body.set(mesh, 67 + name.length);
  const signature = ed25519.sign(body, signSecretKey);
  const out = new Uint8Array(body.length + 64);
  out.set(body);
  out.set(signature, body.length);
  return CARD_URL_PREFIX + toBase64Url(out);
}

export function decodeCard(text: string): ContactCard {
  const trimmed = text.trim();
  if (!trimmed.toLowerCase().startsWith(CARD_URL_PREFIX)) {
    throw new CardError('not a Wavepod contact link');
  }
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(trimmed.slice(CARD_URL_PREFIX.length));
  } catch {
    throw new CardError('corrupted link');
  }
  if (bytes.length < 67 + 1 + 64) throw new CardError('corrupted link');
  if (bytes[0] !== CARD_VERSION)
    throw new CardError(`unsupported card version ${bytes[0]}`);
  const nameLen = bytes[65];
  if (nameLen === 0 || nameLen > MAX_NAME_BYTES)
    throw new CardError('corrupted link');
  const meshLenAt = 66 + nameLen;
  if (meshLenAt >= bytes.length) throw new CardError('corrupted link');
  const meshLen = bytes[meshLenAt];
  const bodyLen = 67 + nameLen + meshLen;
  if (bytes.length !== bodyLen + 64) throw new CardError('corrupted link');

  const body = bytes.slice(0, bodyLen);
  const signature = bytes.slice(bodyLen);
  const signPublicKey = bytes.slice(33, 65);
  let valid = false;
  try {
    valid = ed25519.verify(signature, body, signPublicKey);
  } catch {
    valid = false;
  }
  if (!valid) throw new CardError('invalid signature');

  let name: string;
  try {
    name = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.slice(66, 66 + nameLen),
    );
  } catch {
    throw new CardError('corrupted link');
  }
  return {
    boxPublicKey: bytes.slice(1, 33),
    signPublicKey,
    name,
    meshContact:
      meshLen > 0 ? bytes.slice(meshLenAt + 1, meshLenAt + 1 + meshLen) : null,
  };
}

const B64URL =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n =
      (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64URL[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64URL[n & 63];
  }
  return out;
}

export function fromBase64Url(text: string): Uint8Array {
  // Accept standard base64 too (links pasted from other tools).
  const clean = text
    .replace(/[=]+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  if (clean.length % 4 === 1) throw new Error('invalid base64url length');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let j = 0;
  for (const c of clean) {
    const v = B64URL.indexOf(c);
    if (v < 0) throw new Error('invalid base64url');
    buffer = ((buffer << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j++] = (buffer >> bits) & 0xff;
    }
  }
  return out.slice(0, j);
}
