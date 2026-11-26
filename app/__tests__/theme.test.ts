import { palettes, type Colors } from '../src/ui/theme';

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Text/background pairs actually used by the screens. */
const pairs: [keyof Colors, keyof Colors][] = [
  ['text', 'background'],
  ['text', 'surface'],
  ['textMuted', 'background'],
  ['textMuted', 'surface'],
  ['accent', 'background'],
  ['accent', 'surface'],
  ['accentStrong', 'surface'],
  ['onPrimary', 'primary'],
  ['onPrimary', 'primaryPressed'],
  ['danger', 'background'],
  ['danger', 'surface'],
  ['success', 'surface'],
  ['qrForeground', 'qrBackground'],
];

describe.each(['light', 'dark'] as const)('%s palette', scheme => {
  it.each(pairs)('%s on %s meets WCAG AA (4.5:1)', (fg, bg) => {
    const c = palettes[scheme];
    expect(contrast(c[fg], c[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the brand primary', () => {
    expect(palettes[scheme].primary).toBe('#4F64AA');
  });
});
