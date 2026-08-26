import { formatMinor } from './parse.ts';

export { formatMinor };

/**
 * Short form for deltas and bar labels, where the exact tiyin is noise.
 * 231994.50 so'm -> "232k". Keeps the sign.
 */
export function formatCompactMinor(minor: number): string {
  const major = Math.round(Math.abs(minor) / 100);
  const sign = minor < 0 ? '-' : '+';
  if (major >= 1_000_000) return `${sign}${(major / 1_000_000).toFixed(1)}m`;
  if (major >= 1_000) return `${sign}${Math.round(major / 1_000)}k`;
  return `${sign}${major}`;
}

/** "2026-08" -> "AUGUST". Terminal headers are uppercase. */
export function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  const name = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    timeZone: 'UTC',
  });
  return name.toUpperCase();
}

/**
 * Month bucket in the viewer's local timezone.
 *
 * Imported rows sit at midnight UTC on the 1st, so local and UTC agree on them
 * for any timezone east of the line. Rows typed into the app later carry a real
 * local instant, and those must bucket by local month — grouping by UTC would
 * push an entry made just after midnight into the previous month.
 */
export function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
