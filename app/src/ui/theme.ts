import { StyleSheet } from 'react-native';

export const OCEAN = '#1D6FA5';
export const OCEAN_LIGHT = '#e6eef4';
export const MUTED = '#667085';
export const DANGER = '#b42318';
export const OK = '#067647';

export const ui = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 12, backgroundColor: 'white' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    backgroundColor: 'white',
  },
  title: { fontSize: 22, fontWeight: '700', color: OCEAN },
  heading: { fontSize: 16, fontWeight: '600', color: '#101828' },
  body: { fontSize: 15, color: '#101828' },
  muted: { fontSize: 13, color: MUTED },
  error: { fontSize: 14, color: DANGER },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#d0d5dd',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d5dd',
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  back: { color: OCEAN, fontSize: 16, paddingVertical: 4 },
  safety: {
    fontSize: 22,
    fontVariant: ['tabular-nums'],
    letterSpacing: 2,
    color: '#101828',
    textAlign: 'center',
  },
});
