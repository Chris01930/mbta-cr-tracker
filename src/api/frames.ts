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
  // Unknown/extra fields are ignored (see normalizeDayFrames).
  return normalizeDayFrames(await res.json());
}

/** A frames-file train as served: the modeled fields plus the optional `rev`/`vid`. */
type RawFramesTrain = Partial<Train> & { rev?: string; vid?: string };

/**
 * Normalize a raw day-frames document into the app's model. The only
 * transform today is mapping the optional `rev` field to `isNonRevenue`
 * (absent -> false, absent from all frames written before 2026-07-19). Unknown
 * fields are ignored by construction — this is where any future per-train
 * normalization would live.
 */
export function normalizeDayFrames(raw: unknown): DayFrames {
  const doc = (raw ?? {}) as { date?: string; updated?: string; frames?: unknown[] };
  const frames: Frame[] = (Array.isArray(doc.frames) ? doc.frames : []).map((f) => {
    const frame = (f ?? {}) as { key?: string; time?: string; trains?: RawFramesTrain[] };
    const trains: Train[] = (Array.isArray(frame.trains) ? frame.trains : []).map((t) => {
      const cab = t.cab ?? null;
      return {
        cab,
        train: t.train ?? null,
        dest: t.dest ?? null,
        route: t.route ?? null,
        status: t.status ?? null,
        lat: t.lat as number,
        lon: t.lon as number,
        brg: t.brg ?? null,
        upd: t.upd ?? null,
        isNonRevenue: t.rev === 'NON_REVENUE',
        isGhost: cab == null,
        vid: t.vid ?? null,
      };
    });
    return { key: frame.key ?? '', time: frame.time ?? '', trains };
  });
  return { date: doc.date ?? '', updated: doc.updated ?? '', frames };
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
