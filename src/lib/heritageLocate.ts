import type { Frame, Train } from '../types';

/**
 * Where a heritage unit's paired cab is (or last was) for the current day, at
 * the currently-displayed time. `isCurrent` distinguishes an active position
 * (the cab is on the map right now / at the scrubbed frame) from a stale
 * "last known" fix earlier in the day.
 */
export interface UnitLocation {
  lat: number;
  lon: number;
  timeMs: number;
  isCurrent: boolean;
}

/**
 * Locate a cab at or before `currentTimeMs`.
 *
 * 1. If the cab is in `currentTrains` (the displayed instant — live poll or the
 *    scrubbed playback frame), that's its current location.
 * 2. Otherwise scan `frames` newest-first for the most recent fix at or before
 *    the current time — the last known location. Frames are chronological, so
 *    the first backward match wins (early return).
 *
 * Future frames (after the current playback time) are ignored, so scrubbing
 * back in time never reveals a position the unit hasn't reached yet.
 */
export function locateCab(
  cab: string,
  frames: Frame[],
  currentTimeMs: number,
  currentTrains: Train[],
): UnitLocation | null {
  const cur = currentTrains.find(
    (t) => t.cab === cab && Number.isFinite(t.lat) && Number.isFinite(t.lon),
  );
  if (cur) return { lat: cur.lat, lon: cur.lon, timeMs: currentTimeMs, isCurrent: true };

  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i];
    const frameMs = Date.parse(frame.time);
    if (Number.isFinite(frameMs) && frameMs > currentTimeMs) continue; // skip the future
    for (const tr of frame.trains) {
      if (tr.cab !== cab || !Number.isFinite(tr.lat) || !Number.isFinite(tr.lon)) continue;
      const updMs = tr.upd ? Date.parse(tr.upd) : NaN;
      const timeMs = Number.isFinite(updMs) ? updMs : Number.isFinite(frameMs) ? frameMs : currentTimeMs;
      return { lat: tr.lat, lon: tr.lon, timeMs, isCurrent: false };
    }
  }
  return null;
}
