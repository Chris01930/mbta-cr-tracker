import { getConfig } from '../config/configStore';
import type { DayFrames, Frame, Train } from '../types';

/**
 * Loader for the historical archive (per-day JSON frames on CloudFront).
 *
 * Files are served gzip with `Content-Encoding: gzip`; React Native's fetch
 * uses the platform HTTP stack which decompresses automatically, so we can
 * read `.json()` directly. A 403 on /frames/* means "no data for that date"
 * (S3 returns an XML AccessDenied) — surfaced as `NoDataError`.
 *
 * Load a day file ONCE per selected date; never poll it on a timer. Today's
 * file is only used to seed a live session.
 */

export class NoDataError extends Error {
  constructor(public date: string) {
    super(`No archive data for ${date}`);
    this.name = 'NoDataError';
  }
}

export function framesUrl(date: string): string {
  return `${getConfig().framesBase.replace(/\/$/, '')}/${date}.json`;
}

export async function loadDayFrames(date: string, signal?: AbortSignal): Promise<DayFrames> {
  const res = await fetch(framesUrl(date), { signal });
  if (res.status === 403) throw new NoDataError(date);
  if (!res.ok) throw new Error(`frames ${date}: HTTP ${res.status}`);
  const body = (await res.json()) as DayFrames;
  // Frames are already sorted by key, but reconstruct empty-poll times if a
  // frame arrives with no `time` (defensive; overnight empties have time set).
  return body;
}

/** The newest (last) frame in a day file — used to seed a live session. */
export function latestFrame(day: DayFrames): Frame | undefined {
  return day.frames.length ? day.frames[day.frames.length - 1] : undefined;
}

/** All trains that have a plottable position in a frame. */
export function plottableTrains(frame: Frame | undefined): Train[] {
  if (!frame) return [];
  return frame.trains.filter(
    (t) => typeof t.lat === 'number' && typeof t.lon === 'number' && !isNaN(t.lat) && !isNaN(t.lon),
  );
}
