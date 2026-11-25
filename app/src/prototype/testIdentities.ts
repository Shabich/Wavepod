/** Hardcoded test identities A/B for the prototype only. Removed with QR contacts (task 04). */
import { sha256 } from '@noble/hashes/sha2.js';
import { identityFromSeed, type Identity } from '../crypto/envelope';

export type Role = 'A' | 'B';

export function testIdentity(role: Role): Identity {
  return identityFromSeed(
    sha256(new TextEncoder().encode(`wavepod-prototype-${role}`)),
  );
}
