/**
 * Wavepod identity. A single 32-byte master seed is kept in the Keychain/Keystore;
 * the X25519 (key agreement) and Ed25519 (signatures) key pairs are derived from it.
 */
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { contactId, type Identity } from './envelope';

export interface WavepodIdentity {
  /** X25519 pair used by the envelope (direct messages). */
  box: Identity;
  /** Ed25519 pair for signatures (QR codes, groups). */
  sign: { secretKey: Uint8Array; publicKey: Uint8Array };
  /** Address derived from the X25519 public key. */
  contactId: string;
  /** Secret shared with contacts (Hello message) to recognise our presence beacons. */
  beaconKey: Uint8Array;
}

const enc = new TextEncoder();

export function newMasterSeed(): Uint8Array {
  return randomBytes(32);
}

export function identityFromMasterSeed(seed: Uint8Array): WavepodIdentity {
  if (seed.length !== 32) throw new Error('master seed must be 32 bytes');
  const boxSecret = hkdf(
    sha256,
    seed,
    undefined,
    enc.encode('wavepod/v1/x25519'),
    32,
  );
  const signSecret = hkdf(
    sha256,
    seed,
    undefined,
    enc.encode('wavepod/v1/ed25519'),
    32,
  );
  const boxPublic = x25519.getPublicKey(boxSecret);
  return {
    box: { secretKey: boxSecret, publicKey: boxPublic },
    sign: {
      secretKey: signSecret,
      publicKey: ed25519.getPublicKey(signSecret),
    },
    contactId: contactId(boxPublic),
    beaconKey: hkdf(sha256, seed, undefined, enc.encode('wavepod/v1/beacon'), 16),
  };
}

/**
 * Short fingerprint shown on both phones to verify a contact:
 * 12 digits in 3 groups, from both X25519 keys (order-independent).
 */
export function safetyNumber(a: Uint8Array, b: Uint8Array): string {
  const [first, second] = compare(a, b) <= 0 ? [a, b] : [b, a];
  const joined = new Uint8Array(first.length + second.length);
  joined.set(first);
  joined.set(second, first.length);
  const h = sha256(joined);
  // 48 bits of the hash, reduced to 12 decimal digits (bias < 0.4 %, fine for display).
  let n = 0;
  for (let i = 0; i < 6; i++) n = n * 256 + h[i];
  const digits = (n % 1e12).toString().padStart(12, '0');
  return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`;
}

function compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}
