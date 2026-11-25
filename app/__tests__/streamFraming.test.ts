import {
  FrameDecoder,
  encodeFrame,
} from '../src/radio/meshtastic/streamFraming';

const bytes = (...b: number[]) => new Uint8Array(b);

describe('stream framing', () => {
  it('encodes the header', () => {
    expect(Array.from(encodeFrame(bytes(1, 2, 3)))).toEqual([
      0x94, 0xc3, 0, 3, 1, 2, 3,
    ]);
  });

  it('decodes frames split across chunks', () => {
    const d = new FrameDecoder();
    const f = encodeFrame(Uint8Array.from({ length: 300 }, (_, i) => i & 0xff));
    expect(d.push(f.slice(0, 1))).toEqual([]);
    expect(d.push(f.slice(1, 3))).toEqual([]);
    expect(d.push(f.slice(3, 200))).toEqual([]);
    const out = d.push(f.slice(200));
    expect(out).toHaveLength(1);
    expect(out[0].length).toBe(300);
  });

  it('decodes several frames in one chunk and skips noise', () => {
    const d = new FrameDecoder();
    const noise = new TextEncoder().encode('DEBUG log line\n');
    const chunk = new Uint8Array([
      ...noise,
      ...encodeFrame(bytes(7)),
      0x94,
      ...encodeFrame(bytes(8, 9)),
    ]);
    expect(d.push(chunk).map(f => Array.from(f))).toEqual([[7], [8, 9]]);
  });

  it('resyncs after a corrupt length', () => {
    const d = new FrameDecoder();
    const chunk = new Uint8Array([
      0x94,
      0xc3,
      0xff,
      0xff,
      ...encodeFrame(bytes(5)),
    ]);
    expect(d.push(chunk).map(f => Array.from(f))).toEqual([[5]]);
  });

  it('accepts empty frames', () => {
    expect(new FrameDecoder().push(encodeFrame(bytes()))).toHaveLength(1);
  });
});
