/**
 * Presence beacon: one broadcast packet of 9 bytes, recognised only by contacts.
 *
 *   byte 0     version (high 4 bits) | type Beacon (low 4 bits)
 *   bytes 1-8  token = HMAC-SHA256(beaconKey, window)[0..8]
 *
 * window = floor(time / 15 min). Each identity has a secret beacon key, sent to every
 * contact once in an encrypted Hello message. Outsiders can neither forge a beacon nor
 * link two windows' tokens to a Wavepod identity. They still see the Meshtastic
 * sender node in the clear header: the beacon hides who, not that a module talks.
 */
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { MessageType, PROTOCOL_VERSION } from '../protocol/codec';

export const BEACON_WINDOW_MS = 15 * 60_000;
export const BEACON_LENGTH = 9;
export const BEACON_KEY_LENGTH = 16;

export function windowOf(t: number) {
  return Math.floor(t / BEACON_WINDOW_MS);
}

export function beaconToken(key: Uint8Array, window: number): Uint8Array {
  const w = new Uint8Array(8);
  const view = new DataView(w.buffer);
  view.setUint32(0, Math.floor(window / 2 ** 32));
  view.setUint32(4, window >>> 0);
  return hmac(sha256, key, w).slice(0, 8);
}

export function encodeBeacon(key: Uint8Array, now: number): Uint8Array {
  const out = new Uint8Array(BEACON_LENGTH);
  out[0] = (PROTOCOL_VERSION << 4) | MessageType.Beacon;
  out.set(beaconToken(key, windowOf(now)), 1);
  return out;
}

export function isBeacon(payload: Uint8Array) {
  return (
    payload.length === BEACON_LENGTH &&
    payload[0] === ((PROTOCOL_VERSION << 4) | MessageType.Beacon)
  );
}

/**
 * Finds which contact sent a beacon. Accepts the previous and next window too
 * (clock drift between phones, beacon sent at a window boundary).
 */
export function matchBeacon<T extends { beaconKey: Uint8Array | null }>(
  payload: Uint8Array,
  contacts: T[],
  now: number,
): T | null {
  if (!isBeacon(payload)) return null;
  const token = payload.slice(1);
  const w = windowOf(now);
  for (const c of contacts) {
    if (!c.beaconKey) continue;
    for (const win of [w, w - 1, w + 1]) {
      if (equal(beaconToken(c.beaconKey, win), token)) return c;
    }
  }
  return null;
}

/** Next beacon delay: interval ± 25 % jitter, so pods do not transmit in sync. */
export function nextBeaconDelay(
  intervalMs: number,
  random: () => number = Math.random,
) {
  return Math.round(intervalMs * (0.75 + random() * 0.5));
}

function equal(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
