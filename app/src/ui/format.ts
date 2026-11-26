/** "vu il y a 4 min": last radio signal, never "online". */
export function lastSeenLabel(
  lastSeenAt: number | null,
  now = Date.now(),
): string {
  if (lastSeenAt === null) return 'jamais entendu';
  const s = Math.max(0, Math.round((now - lastSeenAt) / 1000));
  if (s < 60) return "vu à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `vu il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `vu il y a ${h} h`;
  return `vu il y a ${Math.round(h / 24)} j`;
}

export function timeLabel(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

/** "4 min", "2 h", "3 j": how long something has lasted. */
export function durationLabel(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} j`;
}
