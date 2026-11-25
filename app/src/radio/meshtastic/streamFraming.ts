/**
 * Meshtastic stream framing, used over TCP (meshtasticd) and serial:
 *   0x94 0xC3 <length MSB> <length LSB> <protobuf bytes>
 * BLE does not use it: each characteristic read/write is one protobuf.
 */

export const START1 = 0x94;
export const START2 = 0xc3;
export const MAX_FRAME_PAYLOAD = 512;

export function encodeFrame(payload: Uint8Array): Uint8Array {
  if (payload.length > MAX_FRAME_PAYLOAD) throw new Error('frame too large');
  const out = new Uint8Array(4 + payload.length);
  out[0] = START1;
  out[1] = START2;
  out[2] = payload.length >> 8;
  out[3] = payload.length & 0xff;
  out.set(payload, 4);
  return out;
}

/**
 * Incremental decoder. Bytes outside a frame (firmware debug text on serial)
 * are skipped until the next start marker.
 */
export class FrameDecoder {
  private buffer = new Uint8Array(0);

  push(chunk: Uint8Array): Uint8Array[] {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;

    const frames: Uint8Array[] = [];
    for (;;) {
      const start = this.findStart();
      if (start < 0) {
        // Keep a trailing START1 that may begin the next frame.
        this.buffer =
          this.buffer[this.buffer.length - 1] === START1
            ? this.buffer.slice(-1)
            : new Uint8Array(0);
        break;
      }
      if (start > 0) this.buffer = this.buffer.slice(start);
      if (this.buffer.length < 4) break;
      const length = (this.buffer[2] << 8) | this.buffer[3];
      if (length > MAX_FRAME_PAYLOAD) {
        // Corrupt header: drop the marker and resync.
        this.buffer = this.buffer.slice(1);
        continue;
      }
      if (this.buffer.length < 4 + length) break;
      frames.push(this.buffer.slice(4, 4 + length));
      this.buffer = this.buffer.slice(4 + length);
    }
    return frames;
  }

  private findStart(): number {
    for (let i = 0; i + 1 < this.buffer.length; i++) {
      if (this.buffer[i] === START1 && this.buffer[i + 1] === START2) return i;
    }
    return -1;
  }
}
