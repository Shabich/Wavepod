import { Utf8TextDecoder } from '../src/polyfills/textDecoder';
import { base64ToBytes, bytesToBase64 } from '../src/radio/meshtastic/base64';
import { toBase64Reference } from './helpers';

describe('Utf8TextDecoder', () => {
  const samples = [
    '',
    'abc',
    'café',
    'Ωμέγα',
    '日本語',
    'emoji 🐬 dauphin',
    '\u{10ffff}',
  ];

  it.each(samples)('matches the platform decoder for %p', s => {
    const bytes = new TextEncoder().encode(s);
    expect(new Utf8TextDecoder().decode(bytes)).toBe(s);
  });

  it('throws on invalid input in fatal mode', () => {
    const d = new Utf8TextDecoder('utf-8', { fatal: true });
    for (const bad of [
      [0xc3],
      [0x80],
      [0xc0, 0xaf],
      [0xed, 0xa0, 0x80],
      [0xf5, 0x80, 0x80, 0x80],
      [0xe2, 0x28, 0xa1],
    ]) {
      expect(() => d.decode(new Uint8Array(bad))).toThrow(TypeError);
    }
  });

  it('substitutes U+FFFD when not fatal', () => {
    expect(
      new Utf8TextDecoder().decode(new Uint8Array([0x61, 0xff, 0x62])),
    ).toBe('a�b');
  });

  it('keeps or strips the BOM', () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x61]);
    expect(new Utf8TextDecoder().decode(bom)).toBe('a');
    expect(new Utf8TextDecoder('utf-8', { ignoreBOM: true }).decode(bom)).toBe(
      '﻿a',
    );
  });
});

describe('base64', () => {
  it.each([0, 1, 2, 3, 4, 5, 100, 233])('round-trips %i bytes', n => {
    const bytes = Uint8Array.from(
      { length: n },
      (_, i) => (i * 37 + 11) & 0xff,
    );
    const b64 = bytesToBase64(bytes);
    expect(b64).toBe(toBase64Reference(bytes));
    expect(Array.from(base64ToBytes(b64))).toEqual(Array.from(bytes));
  });
});
