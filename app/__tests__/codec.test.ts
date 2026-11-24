import {
  CodecError,
  HEADER_LENGTH,
  MAX_PLAINTEXT_LENGTH,
  MessageType,
  OVERHEAD,
  decodeAckBody,
  decodeHeader,
  encodeAckBody,
  encodeHeader,
  encodeText,
  decodeText,
} from '../src/protocol/codec';

const ext = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

describe('codec', () => {
  it('has a 31-byte fixed overhead', () => {
    expect(OVERHEAD).toBe(31);
    expect(MAX_PLAINTEXT_LENGTH).toBe(169);
  });

  it('round-trips the header', () => {
    const h = encodeHeader(MessageType.Text, 0xbeef, 0xdeadbeef, ext);
    expect(h.length).toBe(HEADER_LENGTH);
    const envelope = new Uint8Array(OVERHEAD);
    envelope.set(h);
    const d = decodeHeader(envelope);
    expect(d).toMatchObject({
      version: 1,
      type: MessageType.Text,
      keyHint: 0xbeef,
      messageId: 0xdeadbeef,
    });
    expect(Array.from(d.nonce)).toEqual([
      0xde, 0xad, 0xbe, 0xef, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it('rejects unknown versions and types', () => {
    const envelope = new Uint8Array(OVERHEAD);
    envelope.set(encodeHeader(MessageType.Ack, 1, 1, ext));
    envelope[0] = 0x21;
    expect(() => decodeHeader(envelope)).toThrow(CodecError);
    envelope[0] = 0x1f;
    expect(() => decodeHeader(envelope)).toThrow(CodecError);
  });

  it('rejects envelopes that are too short or too long', () => {
    expect(() => decodeHeader(new Uint8Array(OVERHEAD - 1))).toThrow(
      CodecError,
    );
    const long = new Uint8Array(234);
    long[0] = 0x11;
    expect(() => decodeHeader(long)).toThrow(CodecError);
  });

  it('round-trips grouped acks', () => {
    const ids = [1, 0xffffffff, 42];
    expect(decodeAckBody(encodeAckBody(ids))).toEqual(ids);
    expect(() => decodeAckBody(new Uint8Array(3))).toThrow(CodecError);
  });

  it('enforces the text length limit in bytes', () => {
    expect(decodeText(encodeText('Salut, on se retrouve au refuge ?'))).toBe(
      'Salut, on se retrouve au refuge ?',
    );
    expect(() => encodeText('é'.repeat(85))).toThrow(CodecError); // 170 bytes
    expect(encodeText('é'.repeat(84)).length).toBe(168);
    expect(() => encodeText('')).toThrow(CodecError);
  });

  it('rejects invalid UTF-8', () => {
    expect(() => decodeText(new Uint8Array([0xc3]))).toThrow(CodecError);
  });
});
