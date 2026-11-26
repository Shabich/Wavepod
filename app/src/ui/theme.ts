/**
 * Wavepod brand (orca logo, brand/). Colors measured on the logo files:
 *   primary #4F64AA (icon background), primaryDark #384986 (orca eye),
 *   night #1B2340, slate #5A6178, mist #EEF1F9.
 * Contrast (WCAG): white on primary 5.6, slate on white 6.2, slate on mist 5.4,
 * night on mist 13.7 — all text pairs pass AA.
 */
import { StyleSheet } from 'react-native';

export const colors = {
  primary: '#4F64AA',
  primaryDark: '#384986',
  night: '#1B2340',
  slate: '#5A6178',
  mist: '#EEF1F9',
  border: '#D5DAEA',
  white: '#FFFFFF',
  success: '#067647',
  danger: '#B42318',
} as const;

export const radius = { card: 16, button: 14, bubble: 18 } as const;

export const ui = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 12, backgroundColor: colors.white },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    backgroundColor: colors.white,
  },
  title: { fontSize: 24, fontWeight: '700', color: colors.night },
  heading: { fontSize: 16, fontWeight: '600', color: colors.night },
  body: { fontSize: 15, color: colors.night },
  muted: { fontSize: 13, color: colors.slate },
  error: { fontSize: 14, color: colors.danger },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.night,
    backgroundColor: colors.white,
  },
  card: {
    backgroundColor: colors.mist,
    borderRadius: radius.card,
    padding: 14,
    gap: 6,
  },
  back: { color: colors.primary, fontSize: 16, paddingVertical: 4 },
  safety: {
    fontSize: 22,
    fontVariant: ['tabular-nums'],
    letterSpacing: 2,
    color: colors.night,
    textAlign: 'center',
  },
});
