import type { Train } from '../types';

/**
 * Stable identity for a train across polls: cab label is primary (a cab runs
 * many trains per day); ghosts (null label) fall back to trip/position. Shared
 * by every consumer so dedupe and marker keys agree.
 */
export function trainKey(t: Train): string {
  return `cab:${t.cab ?? `ghost:${t.tripId ?? t.train ?? `${t.lat},${t.lon}`}`}`;
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
