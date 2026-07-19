import type { Train } from '../types';

/**
 * Stable tracking identity for a train: cab label when present, else the
 * vehicle id (`vid`) for ghosts. Two simultaneous live ghosts always differ
 * (distinct vids). Pre-2026-07-19 ghosts lack vid — fall back to a per-snapshot
 * position surrogate (distinct markers now; imperfect history, but never a
 * silent merge of live ghosts). Shared by dedupe, marker keys, and selection.
 */
export function trainKey(t: Train): string {
  if (t.cab) return `cab:${t.cab}`;
  if (t.vid) return `vid:${t.vid}`;
  return `pos:${t.lat},${t.lon}`;
}

/** Compact marker-badge label: cab number, else the ghost's vid, else "Ghost". */
export function trainLabel(t: Train): string {
  return t.cab ?? t.vid ?? 'Ghost';
}

/** Full display title used in the inspect chip. */
export function trainTitle(t: Train): string {
  if (t.cab) return `Cab ${t.cab} · Trn ${t.train ?? '—'}`;
  return t.vid ? `Ghost ${t.vid}` : 'Ghost';
}

/**
 * Collapse duplicate identities (a cab appearing twice in one poll — a feed
 * quirk, or a ghost sharing a label) to one entry, last occurrence winning
 * (freshest position). Also drops non-plottable rows. Callers memoize on the
 * source array so the store snapshot itself stays a stable reference.
 */
export function dedupeTrains(trains: Train[]): Train[] {
  const byKey = new Map<string, Train>();
  for (const t of trains) {
    if (typeof t.lat !== 'number' || typeof t.lon !== 'number') continue;
    byKey.set(trainKey(t), t);
  }
  return Array.from(byKey.values());
}
