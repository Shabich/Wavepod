import {
  EnvelopeError,
  contactId,
  deriveSessionKey,
  generateIdentity,
  keyHint,
  open,
  seal,
} from '../src/crypto/envelope';
import {
  MessageType,
  OVERHEAD,
  encodeText,
  decodeText,
} from '../src/protocol/codec';
import { bytesEqual, containsBytes, utf8 } from './helpers';

describe('envelope', () => {
  const alice = generateIdentity();
  const bob = generateIdentity();
  const kAlice = deriveSessionKey(alice, bob.publicKey);
  const kBob = deriveSessionKey(bob, alice.publicKey);

  it('derives the same session key on both sides', () => {
    expect(bytesEqual(kAlice, kBob)).toBe(true);
    const eve = generateIdentity();
    expect(bytesEqual(deriveSessionKey(eve, bob.publicKey), kBob)).toBe(false);
  });

  it('round-trips a text message', () => {
    const env = seal(
      MessageType.Text,
      encodeText('rendez-vous au col'),
      alice.publicKey,
      kAlice,
      7,
    );
    expect(env.length).toBe(OVERHEAD + 'rendez-vous au col'.length);
    const opened = open(env, kBob);
    expect(opened.type).toBe(MessageType.Text);
    expect(opened.messageId).toBe(7);
    expect(opened.keyHint).toBe(keyHint(alice.publicKey));
    expect(decodeText(opened.plaintext)).toBe('rendez-vous au col');
  });

  it('does not leak the plaintext', () => {
    const env = seal(
      MessageType.Text,
      encodeText('secretsecret'),
      alice.publicKey,
      kAlice,
    );
    expect(containsBytes(env, utf8('secret'))).toBe(false);
  });

  it('uses a fresh nonce for each message', () => {
    const a = seal(
      MessageType.Text,
      encodeText('x'),
      alice.publicKey,
      kAlice,
      1,
    );
    const b = seal(
      MessageType.Text,
      encodeText('x'),
      alice.publicKey,
      kAlice,
      1,
    );
    expect(bytesEqual(a.slice(7, 15), b.slice(7, 15))).toBe(false);
  });

  it('rejects tampered ciphertext, header and wrong key', () => {
    const env = seal(
      MessageType.Text,
      encodeText('hello'),
      alice.publicKey,
      kAlice,
    );
    const body = env.slice();
    body[20] ^= 1;
    expect(() => open(body, kBob)).toThrow(EnvelopeError);
    const header = env.slice();
    header[2] ^= 1; // key hint is authenticated
    expect(() => open(header, kBob)).toThrow(EnvelopeError);
    const eve = generateIdentity();
    expect(() => open(env, deriveSessionKey(eve, alice.publicKey))).toThrow(
      EnvelopeError,
    );
  });

  it('rejects an all-zero public key', () => {
    expect(() => deriveSessionKey(alice, new Uint8Array(32))).toThrow();
  });

  it('derives a 16-hex-char contact id', () => {
    expect(contactId(alice.publicKey)).toMatch(/^[0-9a-f]{16}$/);
  });
});
