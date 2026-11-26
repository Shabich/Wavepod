/**
 * Wavepod brand (orca logo, brand/README.md), light and dark.
 *
 * Light: primary #4F64AA (icon background), night #1B2340 text, slate #5A6178,
 * mist #EEF1F9 surfaces. Dark: night #1B2340 background, mist text.
 * Every text pair passes WCAG AA (ratios in brand/README.md).
 *
 * Screens never hardcode colors: they read tokens from useTheme() / useStyles().
 */
import React, { createContext, useContext } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';

export type Scheme = 'light' | 'dark';

export interface Colors {
  /** Screen background. */
  background: string;
  /** Cards, incoming bubbles, pressed rows. */
  surface: string;
  border: string;
  text: string;
  textMuted: string;
  /** Filled buttons, outgoing bubbles, avatars. */
  primary: string;
  primaryPressed: string;
  /** Text on primary. */
  onPrimary: string;
  /** Brand color used as text or outline (links, secondary buttons). */
  accent: string;
  /** Badge text. */
  accentStrong: string;
  success: string;
  danger: string;
  placeholder: string;
  /** QR codes stay dark-on-light in both modes so cameras can read them. */
  qrBackground: string;
  qrForeground: string;
}

export const palettes: Record<Scheme, Colors> = {
  light: {
    background: '#FFFFFF',
    surface: '#EEF1F9',
    border: '#D5DAEA',
    text: '#1B2340',
    textMuted: '#5A6178',
    primary: '#4F64AA',
    primaryPressed: '#384986',
    onPrimary: '#FFFFFF',
    accent: '#4F64AA',
    accentStrong: '#384986',
    success: '#067647',
    danger: '#B42318',
    placeholder: '#8A90A6',
    qrBackground: '#FFFFFF',
    qrForeground: '#1B2340',
  },
  dark: {
    background: '#1B2340',
    surface: '#262F52',
    border: '#3A4470',
    text: '#EEF1F9',
    textMuted: '#AEB5CC',
    primary: '#4F64AA',
    primaryPressed: '#3D5096',
    onPrimary: '#FFFFFF',
    accent: '#9DAEEB',
    accentStrong: '#C3CDF5',
    success: '#4ADE95',
    danger: '#FF8A80',
    placeholder: '#7C84A3',
    qrBackground: '#FFFFFF',
    qrForeground: '#1B2340',
  },
};

export const radius = { card: 16, button: 14, bubble: 18 } as const;

export function makeUi(c: Colors) {
  return StyleSheet.create({
    screen: { flex: 1, padding: 16, gap: 12, backgroundColor: c.background },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
      padding: 24,
      backgroundColor: c.background,
    },
    title: { fontSize: 24, fontWeight: '700', color: c.text },
    heading: { fontSize: 16, fontWeight: '600', color: c.text },
    body: { fontSize: 15, color: c.text },
    muted: { fontSize: 13, color: c.textMuted },
    error: { fontSize: 14, color: c.danger },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: c.text,
      backgroundColor: c.background,
    },
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.card,
      padding: 14,
      gap: 6,
    },
    back: { color: c.accent, fontSize: 16, paddingVertical: 4 },
    safety: {
      fontSize: 22,
      fontVariant: ['tabular-nums'],
      letterSpacing: 2,
      color: c.text,
      textAlign: 'center',
    },
  });
}

export interface Theme {
  scheme: Scheme;
  colors: Colors;
  ui: ReturnType<typeof makeUi>;
}

const themes: Record<Scheme, Theme> = {
  light: {
    scheme: 'light',
    colors: palettes.light,
    ui: makeUi(palettes.light),
  },
  dark: { scheme: 'dark', colors: palettes.dark, ui: makeUi(palettes.dark) },
};

const ThemeContext = createContext<Theme>(themes.light);

/** Follows the phone's light/dark setting. */
export function ThemeProvider({
  children,
  scheme,
}: {
  children: React.ReactNode;
  /** Forces a scheme (tests, previews). */
  scheme?: Scheme;
}) {
  const system = useColorScheme();
  const current: Scheme = scheme ?? (system === 'dark' ? 'dark' : 'light');
  return (
    <ThemeContext.Provider value={themes[current]}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

const styleCache = new WeakMap<object, Map<Scheme, unknown>>();

/**
 * Screen-specific styles built from the current palette. Factories are module-level
 * constants, so each one is evaluated once per scheme and cached.
 */
export function useStyles<T>(factory: (c: Colors) => T): T {
  const { scheme, colors } = useTheme();
  let byScheme = styleCache.get(factory);
  if (!byScheme) {
    byScheme = new Map();
    styleCache.set(factory, byScheme);
  }
  if (!byScheme.has(scheme)) byScheme.set(scheme, factory(colors));
  return byScheme.get(scheme) as T;
}
