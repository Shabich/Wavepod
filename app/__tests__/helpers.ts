export const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function containsBytes(
  haystack: Uint8Array,
  needle: Uint8Array,
): boolean {
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((v, j) => haystack[i + j] === v)) return true;
  }
  return false;
}

export const utf8 = (s: string) => new TextEncoder().encode(s);

export function toBase64Reference(bytes: Uint8Array): string {
  // Independent reference implementation for the base64 test (no Buffer in RN types).
  let bin = '';
  bytes.forEach(b => (bin += String.fromCharCode(b)));
  return (globalThis as unknown as { btoa(s: string): string }).btoa(bin);
}
