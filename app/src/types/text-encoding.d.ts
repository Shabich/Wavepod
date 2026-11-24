// Hermes provides TextEncoder; TextDecoder comes from src/polyfills/textDecoder.ts.
// The React Native TypeScript config does not include the DOM lib, so declare them here.
declare class TextEncoder {
  readonly encoding: string;
  encode(input?: string): Uint8Array;
}
declare class TextDecoder {
  constructor(
    label?: string,
    options?: { fatal?: boolean; ignoreBOM?: boolean },
  );
  readonly encoding: string;
  decode(input?: ArrayBuffer | ArrayBufferView): string;
}
