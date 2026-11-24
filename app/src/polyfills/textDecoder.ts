/**
 * Minimal UTF-8 TextDecoder for runtimes that lack one (Hermes provides TextEncoder only).
 * Needed by protobuf-es and by the Wavepod codec. Supports `fatal` and `ignoreBOM`.
 */
export class Utf8TextDecoder {
  readonly encoding = 'utf-8';
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;

  constructor(
    label = 'utf-8',
    options: { fatal?: boolean; ignoreBOM?: boolean } = {},
  ) {
    if (!/^utf-?8$/i.test(label))
      throw new RangeError(`unsupported encoding ${label}`);
    this.fatal = options.fatal ?? false;
    this.ignoreBOM = options.ignoreBOM ?? false;
  }

  decode(input?: ArrayBuffer | ArrayBufferView): string {
    if (input === undefined) return '';
    const bytes =
      input instanceof Uint8Array
        ? input
        : ArrayBuffer.isView(input)
        ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        : new Uint8Array(input);
    let i = 0;
    if (
      !this.ignoreBOM &&
      bytes[0] === 0xef &&
      bytes[1] === 0xbb &&
      bytes[2] === 0xbf
    )
      i = 3;
    const codes: number[] = [];
    let out = '';
    const fail = () => {
      if (this.fatal) throw new TypeError('invalid UTF-8');
      codes.push(0xfffd);
    };
    while (i < bytes.length) {
      const b = bytes[i];
      let need = 0;
      let cp = 0;
      let min = 0;
      if (b < 0x80) {
        codes.push(b);
        i++;
        continue;
      } else if (b >= 0xc2 && b <= 0xdf) {
        need = 1;
        cp = b & 0x1f;
        min = 0x80;
      } else if (b >= 0xe0 && b <= 0xef) {
        need = 2;
        cp = b & 0x0f;
        min = 0x800;
      } else if (b >= 0xf0 && b <= 0xf4) {
        need = 3;
        cp = b & 0x07;
        min = 0x10000;
      } else {
        fail();
        i++;
        continue;
      }
      let ok = true;
      let j = 1;
      for (; ok && j <= need; j++) {
        const c = bytes[i + j];
        if (c === undefined || (c & 0xc0) !== 0x80) ok = false;
        else cp = (cp << 6) | (c & 0x3f);
      }
      if (!ok || cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
        fail();
        i += Math.max(1, j - 1);
        continue;
      }
      codes.push(cp);
      i += need + 1;
      if (codes.length > 4096) {
        out += String.fromCodePoint(...codes);
        codes.length = 0;
      }
    }
    return out + String.fromCodePoint(...codes);
  }
}

export function installTextDecoder() {
  const g = globalThis as { TextDecoder?: unknown };
  if (typeof g.TextDecoder === 'undefined') g.TextDecoder = Utf8TextDecoder;
}
